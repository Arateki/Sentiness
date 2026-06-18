import {
  FakeProcessRunner,
  InMemoryFileSystem,
  InMemoryGitProvider,
  SilentLogger,
} from '@sentiness/_test-utils';
import type { CheckContext } from '@sentiness/check-sdk';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { playwrightCheck } from './playwright.js';

function context(process: FakeProcessRunner, fs: InMemoryFileSystem): CheckContext {
  return {
    cwd: '/project',
    repoRoot: '/project',
    tier: 'slow',
    trigger: null,
    baseRef: null,
    changedFiles: [],
    changedRanges: new Map(),
    diffOnly: false,
    signal: new AbortController().signal,
    logger: new SilentLogger(),
    fs,
    git: new InMemoryGitProvider(),
    process,
    checkConfig: { enabled: true },
  };
}

function fsWithConfig(extra: Record<string, string> = {}): InMemoryFileSystem {
  return new InMemoryFileSystem({
    '/project/playwright.config.ts': 'export default {};\n',
    '/project/login.spec.ts': "import { test } from '@playwright/test';\n\ntest('x', () => {});\n",
    ...extra,
  });
}

function report(tests: readonly unknown[], stats: Record<string, number>): string {
  return JSON.stringify({
    suites: [
      {
        title: 'login.spec.ts',
        specs: tests,
      },
    ],
    stats,
  });
}

const FAILED_SPEC = {
  title: 'shows an error',
  file: 'login.spec.ts',
  line: 3,
  column: 1,
  tests: [
    {
      projectName: 'chromium',
      status: 'unexpected',
      results: [
        {
          error: { message: 'expect failed' },
          attachments: [
            {
              name: 'screenshot',
              contentType: 'image/png',
              path: '/project/test-results/login-shows-an-error/test-failed-1.png',
            },
            {
              name: 'trace',
              contentType: 'application/zip',
              path: '/project/test-results/login-shows-an-error/trace.zip',
            },
          ],
        },
      ],
    },
  ],
};

describe('playwrightCheck', () => {
  it('declares config files and the passRate metric spec', () => {
    expect(playwrightCheck.configFiles).toEqual([
      'playwright.config.ts',
      'playwright.config.js',
      'playwright.config.mjs',
      'playwright.config.cjs',
    ]);
    expect(playwrightCheck.defaultConfig).toBeUndefined();
    expect(playwrightCheck.metricSpecs?.passRate?.direction).toBe('higher-is-better');
  });

  it('detects playwright availability', async () => {
    const process = new FakeProcessRunner();
    process.enqueue({ exitCode: 0, stdout: 'Version 1.44.0\n', stderr: '' });

    await expect(playwrightCheck.detect(context(process, fsWithConfig()))).resolves.toEqual({
      available: true,
      version: 'Version 1.44.0',
    });

    const missing = new FakeProcessRunner();
    missing.enqueue({ exitCode: 127, stdout: '', stderr: 'not found' });
    const unavailable = await playwrightCheck.detect(context(missing, fsWithConfig()));
    expect(unavailable.available).toBe(false);
  });

  it('skips when no playwright config file exists', async () => {
    const process = new FakeProcessRunner();
    const fs = new InMemoryFileSystem({ '/project/package.json': '{}' });

    const result = await playwrightCheck.run(context(process, fs));

    expect(result.status).toBe('skipped');
    expect(result.skipReason).toContain('playwright.config');
  });

  it('maps failed tests to findings with relative screenshot paths in references', async () => {
    const process = new FakeProcessRunner();
    process.enqueue({
      exitCode: 1,
      stdout: report([FAILED_SPEC], { expected: 3, unexpected: 1, flaky: 0, skipped: 0 }),
      stderr: '',
    });

    const result = await playwrightCheck.run(context(process, fsWithConfig()));

    expect(result.status).toBe('violations');
    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0];
    expect(finding?.severity).toBe('error');
    expect(finding?.ruleId).toBe('playwright-test-failed');
    expect(finding?.location).toMatchObject({ file: 'login.spec.ts', startLine: 3 });
    expect(finding?.message).toContain('shows an error');
    expect(finding?.message).toContain('chromium');
    expect(finding?.message).toContain('expect failed');
    expect(finding?.references).toEqual([
      'test-results/login-shows-an-error/test-failed-1.png',
      'test-results/login-shows-an-error/trace.zip',
    ]);
    expect(finding?.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(result.metrics).toMatchObject({
      testsExpected: 3,
      testsUnexpected: 1,
      testsFlaky: 0,
      testsSkipped: 0,
      passRate: 75,
    });
  });

  it('returns ok with passRate 100 when everything passes', async () => {
    const process = new FakeProcessRunner();
    process.enqueue({
      exitCode: 0,
      stdout: report([], { expected: 5, unexpected: 0, flaky: 0, skipped: 1 }),
      stderr: '',
    });

    const result = await playwrightCheck.run(context(process, fsWithConfig()));

    expect(result.status).toBe('ok');
    expect(result.findings).toHaveLength(0);
    expect(result.metrics?.passRate).toBe(100);
  });

  it('treats unparseable output as an error', async () => {
    const process = new FakeProcessRunner();
    process.enqueue({ exitCode: 1, stdout: 'not json', stderr: 'boom' });

    const result = await playwrightCheck.run(context(process, fsWithConfig()));

    expect(result.status).toBe('error');
    expect(result.errorMessage).toBeDefined();
  });

  it('treats exit codes above 1 as tool errors even with parseable output', async () => {
    const process = new FakeProcessRunner();
    process.enqueue({
      exitCode: 130,
      stdout: report([], { expected: 0, unexpected: 0, flaky: 0, skipped: 0 }),
      stderr: 'interrupted',
    });

    const result = await playwrightCheck.run(context(process, fsWithConfig()));

    expect(result.status).toBe('error');
    expect(result.errorMessage).toContain('130');
  });

  it('handles findings without line, project, or readable source file', async () => {
    const process = new FakeProcessRunner();
    process.enqueue({
      exitCode: 1,
      stdout: report(
        [
          {
            title: 'missing pieces',
            file: 'ghost.spec.ts',
            tests: [
              {
                status: 'unexpected',
                results: [
                  {
                    attachments: [
                      {
                        name: 'screenshot',
                        contentType: 'image/png',
                        path: 'already-relative.png',
                      },
                      { name: 'video', contentType: 'video/webm', path: '/elsewhere/out.webm' },
                    ],
                  },
                ],
              },
            ],
          },
        ],
        { expected: 0, unexpected: 1, flaky: 0, skipped: 0 },
      ),
      stderr: '',
    });

    const result = await playwrightCheck.run(context(process, fsWithConfig()));

    const finding = result.findings[0];
    expect(finding?.location).toEqual({ file: 'ghost.spec.ts' });
    expect(finding?.message).toBe('login.spec.ts > missing pieces failed');
    expect(finding?.references).toEqual(['already-relative.png', '/elsewhere/out.webm']);
    expect(finding?.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(result.metrics?.passRate).toBe(0);
  });

  it('maps flaky tests to warnings', async () => {
    const process = new FakeProcessRunner();
    process.enqueue({
      exitCode: 0,
      stdout: report(
        [
          {
            title: 'sometimes works',
            file: 'login.spec.ts',
            line: 3,
            tests: [{ projectName: 'chromium', status: 'flaky', results: [] }],
          },
        ],
        { expected: 1, unexpected: 0, flaky: 1, skipped: 0 },
      ),
      stderr: '',
    });

    const result = await playwrightCheck.run(context(process, fsWithConfig()));

    expect(result.status).toBe('violations');
    expect(result.findings[0]?.severity).toBe('warning');
    expect(result.findings[0]?.ruleId).toBe('playwright-test-flaky');
    expect(result.findings[0]?.message).toContain('was flaky');
  });

  it('produces well-formed fingerprints for arbitrary test titles', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 1 }), async (title) => {
        const process = new FakeProcessRunner();
        process.enqueue({
          exitCode: 1,
          stdout: report([{ ...FAILED_SPEC, title }], {
            expected: 0,
            unexpected: 1,
            flaky: 0,
            skipped: 0,
          }),
          stderr: '',
        });
        const result = await playwrightCheck.run(context(process, fsWithConfig()));
        expect(result.findings[0]?.fingerprint).toMatch(/^[a-f0-9]{64}$/);
      }),
    );
  });
});

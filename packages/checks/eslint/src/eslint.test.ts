import {
  FakeProcessRunner,
  InMemoryFileSystem,
  InMemoryGitProvider,
  SilentLogger,
} from '@sentiness/_test-utils';
import type { CheckContext } from '@sentiness/check-sdk';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { eslintCheck } from './eslint.js';

type ContextOverrides = {
  readonly diffOnly?: boolean;
  readonly changedFiles?: readonly string[];
  readonly checkConfig?: Record<string, unknown>;
};

function context(
  process: FakeProcessRunner,
  fs: InMemoryFileSystem,
  overrides: ContextOverrides = {},
): CheckContext {
  return {
    cwd: '/project',
    repoRoot: '/project',
    tier: 'standard',
    trigger: null,
    baseRef: null,
    changedFiles: overrides.changedFiles ?? [],
    changedRanges: new Map(),
    diffOnly: overrides.diffOnly ?? false,
    signal: new AbortController().signal,
    logger: new SilentLogger(),
    fs,
    git: new InMemoryGitProvider(),
    process,
    checkConfig: overrides.checkConfig ?? { enabled: true },
  };
}

function fsWithConfig(extra: Record<string, string> = {}): InMemoryFileSystem {
  return new InMemoryFileSystem({
    '/project/eslint.config.js': 'export default [];\n',
    '/project/src/App.vue':
      '<template>\n  <li v-for="item in items">{{ item }}</li>\n</template>\n',
    ...extra,
  });
}

function eslintOutput(filePath: string, messages: readonly unknown[]): string {
  return JSON.stringify([
    {
      filePath,
      messages,
      suppressedMessages: [],
      errorCount: messages.length,
      fatalErrorCount: 0,
      warningCount: 0,
      fixableErrorCount: 0,
      fixableWarningCount: 0,
      usedDeprecatedRules: [],
    },
  ]);
}

const VUE_MESSAGE = {
  ruleId: 'vue/require-v-for-key',
  severity: 2,
  message: "Elements in iteration expect to have 'v-bind:key' directives.",
  line: 2,
  column: 3,
  endLine: 2,
  endColumn: 40,
} as const;

describe('eslintCheck', () => {
  it('exposes the documented check surface', () => {
    expect(eslintCheck.id).toBe('eslint');
    expect(eslintCheck.category).toBe('lint');
    expect(eslintCheck.defaultTier).toBe('standard');
    expect(eslintCheck.configFiles).toContain('eslint.config.js');
    expect(eslintCheck.configFiles).toContain('eslint.config.mjs');
  });

  it('detects eslint availability', async () => {
    const process = new FakeProcessRunner();
    process.enqueue({ stdout: 'v9.5.0\n', stderr: '', exitCode: 0 });

    await expect(eslintCheck.detect(context(process, fsWithConfig()))).resolves.toEqual({
      available: true,
      version: 'v9.5.0',
    });
    expect(process.calls[0]).toMatchObject({ command: 'eslint', args: ['--version'] });
  });

  it('reports eslint as unavailable when the binary is missing', async () => {
    const process = new FakeProcessRunner();
    process.enqueue({ stdout: '', stderr: 'eslint: command not found', exitCode: 1 });

    await expect(eslintCheck.detect(context(process, fsWithConfig()))).resolves.toEqual({
      available: false,
      reason: 'eslint: command not found',
    });
  });

  it('skips when no flat config file exists', async () => {
    const process = new FakeProcessRunner();
    const fs = new InMemoryFileSystem({ '/project/src/index.ts': 'export {};\n' });

    const result = await eslintCheck.run(context(process, fs));

    expect(result.status).toBe('skipped');
    expect(result.skipReason).toContain('eslint.config');
    expect(process.calls).toHaveLength(0);
  });

  it('lints the project root by default and returns ok without findings', async () => {
    const process = new FakeProcessRunner();
    process.enqueue({ stdout: eslintOutput('/project/src/App.vue', []), stderr: '', exitCode: 0 });

    const result = await eslintCheck.run(context(process, fsWithConfig()));

    expect(result.status).toBe('ok');
    expect(result.findings).toEqual([]);
    expect(process.calls[0]).toMatchObject({
      command: 'eslint',
      args: ['--format', 'json', '.'],
    });
  });

  it('maps exit 1 with diagnostics to violations with fingerprints and locations', async () => {
    const process = new FakeProcessRunner();
    process.enqueue({
      stdout: eslintOutput('/project/src/App.vue', [VUE_MESSAGE]),
      stderr: '',
      exitCode: 1,
    });

    const result = await eslintCheck.run(context(process, fsWithConfig()));

    expect(result.status).toBe('violations');
    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0];
    expect(finding).toMatchObject({
      id: 'eslint:vue/require-v-for-key',
      ruleId: 'vue/require-v-for-key',
      severity: 'error',
      location: { file: 'src/App.vue', startLine: 2, startColumn: 3, endLine: 2, endColumn: 40 },
    });
    expect(finding?.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it('returns ok without invoking eslint when diffOnly has no changed files', async () => {
    const process = new FakeProcessRunner();

    const result = await eslintCheck.run(context(process, fsWithConfig(), { diffOnly: true }));

    expect(result.status).toBe('ok');
    expect(process.calls).toHaveLength(0);
  });

  it('lints only changed files in diffOnly mode', async () => {
    const process = new FakeProcessRunner();
    process.enqueue({ stdout: '[]', stderr: '', exitCode: 0 });

    await eslintCheck.run(
      context(process, fsWithConfig(), {
        diffOnly: true,
        changedFiles: ['src/App.vue', 'src/util.ts'],
      }),
    );

    expect(process.calls[0]).toMatchObject({
      command: 'eslint',
      args: ['--format', 'json', 'src/App.vue', 'src/util.ts'],
    });
  });

  it('honors configured targets and extraArgs', async () => {
    const process = new FakeProcessRunner();
    process.enqueue({ stdout: '[]', stderr: '', exitCode: 0 });

    await eslintCheck.run(
      context(process, fsWithConfig(), {
        checkConfig: {
          enabled: true,
          targets: ['apps/web'],
          extraArgs: ['--max-warnings', '0'],
        },
      }),
    );

    expect(process.calls[0]).toMatchObject({
      command: 'eslint',
      args: ['--format', 'json', '--max-warnings', '0', 'apps/web'],
    });
  });

  it('maps operational failures (exit >= 2) to an error result', async () => {
    const process = new FakeProcessRunner();
    process.enqueue({ stdout: '', stderr: 'Oops! Something went wrong!', exitCode: 2 });

    const result = await eslintCheck.run(context(process, fsWithConfig()));

    expect(result.status).toBe('error');
    expect(result.errorMessage).toContain('Oops! Something went wrong!');
  });

  it('maps unparseable stdout to an error result', async () => {
    const process = new FakeProcessRunner();
    process.enqueue({ stdout: 'not json at all', stderr: '', exitCode: 1 });

    const result = await eslintCheck.run(context(process, fsWithConfig()));

    expect(result.status).toBe('error');
    expect(result.errorMessage).toContain('failed to parse');
  });

  it('produces a 64-character fingerprint for arbitrary diagnostics', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1 }),
        fc.integer({ min: 1, max: 3 }),
        async (message, line) => {
          const process = new FakeProcessRunner();
          process.enqueue({
            stdout: eslintOutput('/project/src/App.vue', [
              { ruleId: 'vue/no-unused-vars', severity: 2, message, line },
            ]),
            stderr: '',
            exitCode: 1,
          });
          const result = await eslintCheck.run(context(process, fsWithConfig()));
          expect(result.findings[0]?.fingerprint).toMatch(/^[a-f0-9]{64}$/);
        },
      ),
    );
  });
});

import { FakeProcessRunner, InMemoryFileSystem, SilentLogger } from '@sentiness/_test-utils';
import type { CheckContext } from '@sentiness/check-sdk';
import { describe, expect, it } from 'vitest';
import { lockfileLintCheck } from './lockfile-lint.js';

function context(process: FakeProcessRunner, fs: InMemoryFileSystem): CheckContext {
  return {
    cwd: '/project',
    tier: 'standard',
    trigger: null,
    baseRef: null,
    changedFiles: [],
    diffOnly: false,
    signal: new AbortController().signal,
    logger: new SilentLogger(),
    fs,
    process,
    checkConfig: { enabled: true },
  };
}

describe('lockfileLintCheck', () => {
  it('reports pnpm-only projects as unsupported', async () => {
    const detect = await lockfileLintCheck.detect(
      context(new FakeProcessRunner(), new InMemoryFileSystem({ '/project/pnpm-lock.yaml': '' })),
    );

    expect(detect.available).toBe(false);
    expect(detect.reason).toContain('pnpm-lock.yaml');
  });

  it('runs lockfile-lint and maps plain output lines to findings', async () => {
    const process = new FakeProcessRunner();
    process.enqueue({
      exitCode: 1,
      stdout: 'Invalid host registry.example.com\nInvalid integrity field\n',
      stderr: '',
    });
    const result = await lockfileLintCheck.run(
      context(process, new InMemoryFileSystem({ '/project/package-lock.json': '{}' })),
    );

    expect(result.status).toBe('violations');
    expect(result.findings.map((finding) => finding.ruleId)).toEqual([
      'disallowed-host',
      'invalid-integrity',
    ]);
    expect(result.findings[0]?.location.file).toBe('package-lock.json');
    expect(result.findings[0]?.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it('returns an error when lockfile-lint fails without actionable output', async () => {
    const process = new FakeProcessRunner();
    process.enqueue({ exitCode: 2, stdout: '', stderr: '' });

    const result = await lockfileLintCheck.run(
      context(process, new InMemoryFileSystem({ '/project/yarn.lock': '' })),
    );

    expect(result.status).toBe('error');
    expect(result.errorMessage).toContain('exited with 2');
  });
});

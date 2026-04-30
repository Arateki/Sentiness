import { FakeProcessRunner, InMemoryFileSystem, SilentLogger } from '@sentiness/_test-utils';
import type { CheckContext } from '@sentiness/check-sdk';
import { describe, expect, it } from 'vitest';
import { semgrepCheck } from './semgrep.js';

function context(process: FakeProcessRunner, fs = new InMemoryFileSystem()): CheckContext {
  return {
    cwd: '/project',
    tier: 'slow',
    trigger: null,
    baseRef: null,
    changedFiles: [],
    changedRanges: new Map(),
    diffOnly: false,
    signal: new AbortController().signal,
    logger: new SilentLogger(),
    fs,
    process,
    checkConfig: { enabled: true },
  };
}

describe('semgrepCheck', () => {
  it('detects semgrep availability', async () => {
    const process = new FakeProcessRunner();
    process.enqueue({ exitCode: 0, stdout: '1.100.0\n', stderr: '' });

    await expect(semgrepCheck.detect(context(process))).resolves.toEqual({
      available: true,
      version: '1.100.0',
    });
  });

  it('runs semgrep and maps findings with line locations', async () => {
    const process = new FakeProcessRunner();
    process.enqueue({
      exitCode: 1,
      stdout: JSON.stringify({
        results: [
          {
            check_id: 'javascript.lang.security.detect-eval',
            path: 'src/a.ts',
            start: { line: 1, col: 1 },
            extra: { message: 'Avoid eval', severity: 'ERROR', fingerprint: 'abc' },
          },
        ],
      }),
      stderr: '',
    });
    const fs = new InMemoryFileSystem({ '/project/src/a.ts': 'eval(value);\n' });

    const result = await semgrepCheck.run(context(process, fs));

    expect(result.status).toBe('violations');
    expect(result.findings[0]?.location).toMatchObject({ file: 'src/a.ts', startLine: 1 });
    expect(result.findings[0]?.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it('returns an error for semgrep execution errors', async () => {
    const process = new FakeProcessRunner();
    process.enqueue({
      exitCode: 2,
      stdout: JSON.stringify({ results: [], errors: [{}] }),
      stderr: 'bad rule',
    });

    const result = await semgrepCheck.run(context(process));

    expect(result.status).toBe('error');
    expect(result.errorMessage).toBe('bad rule');
  });
});

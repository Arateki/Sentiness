import { FakeProcessRunner, InMemoryFileSystem, SilentLogger } from '@sentiness/_test-utils';
import type { CheckContext } from '@sentiness/check-sdk';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { dependencyCruiserCheck } from './dependency-cruiser.js';

function context(process: FakeProcessRunner, fs = new InMemoryFileSystem()): CheckContext {
  return {
    cwd: '/project',
    tier: 'standard',
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

describe('dependencyCruiserCheck', () => {
  it('detects depcruise availability', async () => {
    const process = new FakeProcessRunner();
    process.enqueue({ exitCode: 0, stdout: '16.0.0\n', stderr: '' });

    await expect(dependencyCruiserCheck.detect(context(process))).resolves.toEqual({
      available: true,
      version: '16.0.0',
    });
  });

  it('runs depcruise and maps findings with precise locations', async () => {
    const process = new FakeProcessRunner();
    process.enqueue({
      exitCode: 1,
      stdout: JSON.stringify({
        summary: {
          violations: [
            {
              from: 'src/a.ts',
              to: 'src/b.ts',
              rule: { name: 'no-circular', severity: 'error' },
              lineNumber: 1,
            },
          ],
        },
      }),
      stderr: '',
    });
    const fs = new InMemoryFileSystem({ '/project/src/a.ts': "import './b';\n" });

    const result = await dependencyCruiserCheck.run(context(process, fs));

    expect(result.status).toBe('violations');
    expect(result.findings[0]?.ruleId).toBe('no-circular');
    expect(result.findings[0]?.location).toMatchObject({ file: 'src/a.ts', startLine: 1 });
    expect(result.findings[0]?.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it('returns an error when JSON output cannot be parsed', async () => {
    const process = new FakeProcessRunner();
    process.enqueue({ exitCode: 1, stdout: 'not json', stderr: '' });

    const result = await dependencyCruiserCheck.run(context(process));

    expect(result.status).toBe('error');
    expect(result.errorMessage).toContain('dependency-cruiser JSON');
  });

  it('keeps fingerprints stable and well-formed for reported violations', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 1 }), async (ruleName) => {
        const process = new FakeProcessRunner();
        process.enqueue({
          exitCode: 1,
          stdout: JSON.stringify({
            summary: { violations: [{ from: 'src/a.ts', rule: { name: ruleName } }] },
          }),
          stderr: '',
        });
        const result = await dependencyCruiserCheck.run(context(process));
        expect(result.findings[0]?.fingerprint).toMatch(/^[a-f0-9]{64}$/);
      }),
    );
  });
});

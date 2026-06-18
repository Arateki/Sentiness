import { FakeProcessRunner, InMemoryFileSystem, SilentLogger } from '@sentiness/_test-utils';
import type { CheckContext } from '@sentiness/check-sdk';
import { describe, expect, it } from 'vitest';
import { jscpdCheck } from './jscpd.js';

function context(process: FakeProcessRunner, fs: InMemoryFileSystem): CheckContext {
  return {
    cwd: '/project',
    repoRoot: '/project',
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

describe('jscpdCheck', () => {
  it('detects jscpd availability', async () => {
    const process = new FakeProcessRunner();
    process.enqueue({ exitCode: 0, stdout: '4.0.0\n', stderr: '' });

    await expect(jscpdCheck.detect(context(process, new InMemoryFileSystem()))).resolves.toEqual({
      available: true,
      version: '4.0.0',
    });
  });

  it('reads the JSON report and maps duplicate findings', async () => {
    const process = new FakeProcessRunner();
    process.enqueue({ exitCode: 1, stdout: '', stderr: '' });
    const fs = new InMemoryFileSystem({
      '/project/src/a.ts': 'one();\ntwo();\nthree();\n',
      '/project/.sentiness/cache/jscpd/jscpd-report.json': JSON.stringify({
        duplicates: [
          {
            firstFile: { name: 'src/a.ts', start: { line: 2 }, end: { line: 3 } },
            secondFile: { name: 'src/b.ts' },
            lines: 2,
          },
        ],
      }),
    });

    const result = await jscpdCheck.run(context(process, fs));

    expect(result.status).toBe('violations');
    expect(result.findings[0]?.location).toMatchObject({ file: 'src/a.ts', startLine: 2 });
    expect(result.findings[0]?.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it('returns an error when jscpd fails and no report can be read', async () => {
    const process = new FakeProcessRunner();
    process.enqueue({ exitCode: 2, stdout: '', stderr: 'failed' });

    const result = await jscpdCheck.run(context(process, new InMemoryFileSystem()));

    expect(result.status).toBe('error');
    expect(result.errorMessage).toBe('failed');
  });
});

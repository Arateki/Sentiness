import { FakeProcessRunner, InMemoryFileSystem, SilentLogger } from '@sentiness/_test-utils';
import { describe, expect, it } from 'vitest';
import { biomeCheck } from './biome.js';

function context(process: FakeProcessRunner) {
  return {
    cwd: '/project',
    tier: 'fast' as const,
    trigger: null,
    baseRef: null,
    changedFiles: [],
    diffOnly: false,
    signal: new AbortController().signal,
    logger: new SilentLogger(),
    fs: new InMemoryFileSystem({ '/project/src/index.ts': 'let value = 1;\n' }),
    process,
    checkConfig: {},
  };
}

describe('biomeCheck', () => {
  it('detects biome availability', async () => {
    const process = new FakeProcessRunner();
    process.enqueue({ stdout: '2.0.0\n', stderr: '', exitCode: 0 });

    await expect(biomeCheck.detect(context(process))).resolves.toEqual({
      available: true,
      version: '2.0.0',
    });
  });

  it('returns findings with fingerprints', async () => {
    const process = new FakeProcessRunner();
    process.enqueue({
      stdout: JSON.stringify({
        diagnostics: [
          {
            category: 'lint/style/useConst',
            severity: 'warning',
            message: 'Use const',
            location: { path: { file: 'src/index.ts' }, start: { line: 1 } },
          },
        ],
      }),
      stderr: '',
      exitCode: 1,
    });

    const result = await biomeCheck.run(context(process));

    expect(result.status).toBe('violations');
    expect(result.findings[0]?.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });
});

import { FakeProcessRunner, InMemoryFileSystem, SilentLogger } from '@sentiness/_test-utils';
import type { CheckContext } from '@sentiness/check-sdk';
import { describe, expect, it } from 'vitest';
import { knipCheck } from './knip.js';

function makeContext(
  fs: InMemoryFileSystem,
  process: FakeProcessRunner,
  diffOnly = false,
  changedFiles: string[] = [],
): CheckContext {
  return {
    cwd: '/project',
    tier: 'standard',
    trigger: null,
    baseRef: null,
    changedFiles,
    diffOnly,
    signal: new AbortController().signal,
    logger: new SilentLogger(),
    fs,
    process,
    checkConfig: { enabled: true },
  };
}

describe('knip', () => {
  it('detects knip when available', async () => {
    const fs = new InMemoryFileSystem();
    const process = new FakeProcessRunner();
    process.enqueue({ exitCode: 0, stdout: '5.0.0\n', stderr: '' });

    const ctx = makeContext(fs, process);
    const detect = await knipCheck.detect(ctx);

    expect(detect.available).toBe(true);
    if (detect.available) {
      expect(detect.version).toBe('5.0.0');
    }
  });

  it('reports unavailable when knip fails to run', async () => {
    const fs = new InMemoryFileSystem();
    const process = new FakeProcessRunner();
    process.enqueue({ exitCode: 1, stderr: 'not found', stdout: '' });

    const ctx = makeContext(fs, process);
    const detect = await knipCheck.detect(ctx);

    expect(detect.available).toBe(false);
    if (!detect.available) {
      expect(detect.reason).toContain('not found');
    }
  });

  it('runs knip and maps findings', async () => {
    const fs = new InMemoryFileSystem({
      '/project/src/index.ts': 'export const unused = 1;\n',
    });
    const process = new FakeProcessRunner();
    process.enqueue({
      exitCode: 0,
      stdout: JSON.stringify({
        exports: [{ file: 'src/index.ts', name: 'unused', line: 1, col: 14 }],
      }),
      stderr: '',
    });

    const ctx = makeContext(fs, process);
    const result = await knipCheck.run(ctx);

    expect(result.status).toBe('violations');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.ruleId).toBe('unused-exports');
    expect(result.findings[0]?.message).toContain('unused');
    expect(result.findings[0]?.location.file).toBe('src/index.ts');
  });

  it('filters findings by changed files if diffOnly is true', async () => {
    const fs = new InMemoryFileSystem({
      '/project/src/index.ts': 'export const unused = 1;\n',
      '/project/src/other.ts': 'export const other = 2;\n',
    });
    const process = new FakeProcessRunner();
    process.enqueue({
      exitCode: 0,
      stdout: JSON.stringify({
        exports: [
          { file: 'src/index.ts', name: 'unused', line: 1 },
          { file: 'src/other.ts', name: 'other', line: 1 },
        ],
      }),
      stderr: '',
    });

    const ctx = makeContext(fs, process, true, ['src/other.ts']);
    const result = await knipCheck.run(ctx);

    expect(result.status).toBe('violations');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.location.file).toBe('src/other.ts');
  });

  it('handles JSON parse error gracefully', async () => {
    const fs = new InMemoryFileSystem();
    const process = new FakeProcessRunner();
    process.enqueue({
      exitCode: 0,
      stdout: 'not json',
      stderr: '',
    });

    const ctx = makeContext(fs, process);
    const result = await knipCheck.run(ctx);

    expect(result.status).toBe('error');
    expect(result.errorMessage).toMatch(/parse|not valid JSON/);
  });

  it('handles read file errors gracefully when caching lines', async () => {
    const fs = new InMemoryFileSystem();
    // No files in FS, so reading src/index.ts will throw
    const process = new FakeProcessRunner();
    process.enqueue({
      exitCode: 0,
      stdout: JSON.stringify({
        exports: [{ file: 'src/index.ts', name: 'unused', line: 1, col: 14 }],
      }),
      stderr: '',
    });

    const ctx = makeContext(fs, process);
    const result = await knipCheck.run(ctx);

    expect(result.status).toBe('violations');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.fingerprint).toBeDefined();
  });
});

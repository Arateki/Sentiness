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

  it('suppresses the Sentiness stack false-positives out of the box (issue #7)', async () => {
    const fs = new InMemoryFileSystem();
    const process = new FakeProcessRunner();
    // Mirrors the report from issue #7: a freshly-onboarded repo where knip,
    // with no project config, flags the Sentiness check packages and the tool
    // binaries they wrap as unused devDependencies, plus a genuinely unused dep.
    process.enqueue({
      exitCode: 0,
      stdout: JSON.stringify({
        devDependencies: [
          '@sentiness/check-biome',
          '@sentiness/check-deps-diff',
          '@sentiness/check-eslint',
          '@sentiness/check-knip',
          '@sentiness/check-playwright',
          'eslint',
          'left-pad',
        ],
      }),
      stderr: '',
    });

    const ctx = makeContext(fs, process);
    const result = await knipCheck.run(ctx);

    expect(result.status).toBe('violations');
    expect(result.findings.map((f) => f.message)).toEqual([
      'Unused unused-dev-dependencies: left-pad',
    ]);
  });

  it('honors extra ignoreDependencies from check config', async () => {
    const fs = new InMemoryFileSystem();
    const process = new FakeProcessRunner();
    process.enqueue({
      exitCode: 0,
      stdout: JSON.stringify({ devDependencies: ['vuetify', 'left-pad'] }),
      stderr: '',
    });

    const ctx = {
      ...makeContext(fs, process),
      checkConfig: { enabled: true, ignoreDependencies: ['vuetify'] },
    };
    const result = await knipCheck.run(ctx);

    expect(result.findings.map((f) => f.message)).toEqual([
      'Unused unused-dev-dependencies: left-pad',
    ]);
  });

  it('drops file-level issues without a file path instead of reporting unknown', async () => {
    const fs = new InMemoryFileSystem();
    const process = new FakeProcessRunner();
    process.enqueue({
      exitCode: 0,
      stdout: JSON.stringify({
        exports: [{ name: 'unused' }],
      }),
      stderr: '',
    });

    const ctx = makeContext(fs, process);
    const result = await knipCheck.run(ctx);

    expect(result.status).toBe('ok');
    expect(result.findings).toHaveLength(0);
  });
});

import { FakeProcessRunner, InMemoryFileSystem, SilentLogger } from '@sentiness/_test-utils';
import type { CheckContext } from '@sentiness/check-sdk';
import { describe, expect, it } from 'vitest';
import { strykerCheck } from './stryker.js';

function makeContext(fs: InMemoryFileSystem, process: FakeProcessRunner): CheckContext {
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

const mockReport = {
  schemaVersion: '1',
  files: {
    'src/index.ts': {
      language: 'typescript',
      mutants: [
        {
          id: '1',
          mutatorName: 'Binary',
          replacement: '+',
          status: 'Killed',
          location: { start: { line: 1, column: 10 }, end: { line: 1, column: 11 } },
        },
        {
          id: '2',
          mutatorName: 'Block',
          replacement: '',
          status: 'Survived',
          location: { start: { line: 5, column: 0 }, end: { line: 5, column: 10 } },
        },
        {
          id: '3',
          mutatorName: 'Logical',
          replacement: '||',
          status: 'NoCoverage',
          location: { start: { line: 8, column: 5 }, end: { line: 8, column: 8 } },
        },
      ],
    },
  },
};

describe('stryker', () => {
  it('detects stryker when available', async () => {
    const fs = new InMemoryFileSystem();
    const process = new FakeProcessRunner();
    process.enqueue({ exitCode: 0, stdout: '7.0.0\n', stderr: '' });

    const ctx = makeContext(fs, process);
    const detect = await strykerCheck.detect(ctx);

    expect(detect.available).toBe(true);
  });

  it('reports findings from mutation report', async () => {
    const fs = new InMemoryFileSystem({
      '/project/reports/mutation/mutation.json': JSON.stringify(mockReport),
    });
    const process = new FakeProcessRunner();
    process.enqueue({ exitCode: 0, stdout: '', stderr: '' });

    const ctx = makeContext(fs, process);
    const result = await strykerCheck.run(ctx);

    expect(result.status).toBe('violations');
    expect(result.findings).toHaveLength(2); // 1 Survived, 1 NoCoverage
    expect(result.findings[0]?.severity).toBe('warning');
    expect(result.findings[0]?.message).toContain('survived');
    expect(result.findings[1]?.severity).toBe('info');
    expect(result.metrics?.mutationScore).toBeCloseTo(33.33, 1); // 1/3 killed
  });

  it('handles missing report as error', async () => {
    const fs = new InMemoryFileSystem();
    const process = new FakeProcessRunner();
    process.enqueue({ exitCode: 1, stdout: '', stderr: 'stryker error' });

    const ctx = makeContext(fs, process);
    const result = await strykerCheck.run(ctx);

    expect(result.status).toBe('error');
    expect(result.errorMessage).toContain('exit 1');
    expect(result.errorMessage).toContain('stryker error');
  });

  it('handles empty mutants correctly', async () => {
    const fs = new InMemoryFileSystem({
      '/project/reports/mutation/mutation.json': JSON.stringify({ schemaVersion: '1', files: {} }),
    });
    const process = new FakeProcessRunner();
    process.enqueue({ exitCode: 0, stdout: '', stderr: '' });

    const ctx = makeContext(fs, process);
    const result = await strykerCheck.run(ctx);

    expect(result.status).toBe('ok');
    expect(result.metrics?.mutationScore).toBe(100);
  });
});

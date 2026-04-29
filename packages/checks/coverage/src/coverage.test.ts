import { FakeProcessRunner, InMemoryFileSystem, SilentLogger } from '@sentiness/_test-utils';
import type { CheckContext } from '@sentiness/check-sdk';
import { describe, expect, it } from 'vitest';
import { coverageCheck } from './coverage.js';

function makeContext(
  fs: InMemoryFileSystem,
  diffOnly = false,
  changedFiles: string[] = [],
  thresholds?: Readonly<Record<string, number>>,
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
    process: new FakeProcessRunner(),
    checkConfig: { enabled: true, thresholds },
  };
}

const mockReport = {
  '/project/src/good.ts': {
    path: '/project/src/good.ts',
    statementMap: { '0': { start: { line: 1 }, end: { line: 1 } } },
    s: { '0': 1 },
  },
  '/project/src/bad.ts': {
    path: '/project/src/bad.ts',
    statementMap: {
      '0': { start: { line: 1 }, end: { line: 1 } },
      '1': { start: { line: 2 }, end: { line: 2 } },
    },
    s: { '0': 1, '1': 0 },
  },
};

describe('coverage', () => {
  it('detects unconditionally', async () => {
    const fs = new InMemoryFileSystem();
    const ctx = makeContext(fs);
    const detect = await coverageCheck.detect(ctx);
    expect(detect.available).toBe(true);
  });

  it('skips if coverage file is missing', async () => {
    const fs = new InMemoryFileSystem();
    const ctx = makeContext(fs);
    const result = await coverageCheck.run(ctx);
    expect(result.status).toBe('skipped');
    expect(result.skipReason).toContain('no coverage report found');
  });

  it('returns error if JSON is malformed', async () => {
    const fs = new InMemoryFileSystem({
      '/project/coverage/coverage-final.json': 'invalid json',
    });
    const ctx = makeContext(fs);
    const result = await coverageCheck.run(ctx);
    expect(result.status).toBe('error');
    expect(result.errorMessage).toContain('Unexpected token');
  });

  it('reports findings below threshold', async () => {
    const fs = new InMemoryFileSystem({
      '/project/coverage/coverage-final.json': JSON.stringify(mockReport),
    });
    // Global threshold 80%. bad.ts has 50% (1/2). good.ts has 100% (1/1).
    const ctx = makeContext(fs);
    const result = await coverageCheck.run(ctx);

    expect(result.status).toBe('violations');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.location.file).toBe('src/bad.ts');
    expect(result.metrics?.lineCoverage).toBeCloseTo(66.66, 1); // 2 out of 3 lines covered total
  });

  it('respects custom thresholds', async () => {
    const fs = new InMemoryFileSystem({
      '/project/coverage/coverage-final.json': JSON.stringify(mockReport),
    });
    // Set global to 40%. Both should pass.
    const ctx = makeContext(fs, false, [], { lineCoverage: 40 });
    const result = await coverageCheck.run(ctx);

    expect(result.status).toBe('ok');
    expect(result.findings).toHaveLength(0);
  });

  it('applies diffThreshold for changed files when diffOnly is true', async () => {
    const fs = new InMemoryFileSystem({
      '/project/coverage/coverage-final.json': JSON.stringify(mockReport),
    });
    // bad.ts changed, diffThreshold is 90%, it fails.
    const ctx = makeContext(fs, true, ['src/bad.ts'], { diffLineCoverage: 90 });
    const result = await coverageCheck.run(ctx);

    expect(result.status).toBe('violations');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.location.file).toBe('src/bad.ts');
  });

  it('handles empty statement maps correctly', async () => {
    const fs = new InMemoryFileSystem({
      '/project/coverage/coverage-final.json': JSON.stringify({
        '/project/src/empty.ts': { path: '/project/src/empty.ts', statementMap: {}, s: {} },
        '/project/src/broken.ts': {
          path: '/project/src/broken.ts',
          statementMap: { '0': null },
          s: { '0': 0 },
        },
      }),
    });
    const ctx = makeContext(fs);
    const result = await coverageCheck.run(ctx);

    expect(result.status).toBe('ok');
    expect(result.metrics?.lineCoverage).toBe(100); // 0 total lines = 100%
  });
});

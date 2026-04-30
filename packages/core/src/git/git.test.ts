import { FakeProcessRunner } from '@sentiness/_test-utils';
import { describe, expect, it } from 'vitest';
import { createGitProvider, parseChangedLineRanges } from './git.js';

describe('parseChangedLineRanges', () => {
  it('parses unified=0 hunks across multiple files', () => {
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      'index 1111..2222 100644',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -10,0 +11,3 @@',
      '+added line 1',
      '+added line 2',
      '+added line 3',
      '@@ -50,2 +53,1 @@',
      '+single replacement',
      'diff --git a/src/b.ts b/src/b.ts',
      '--- a/src/b.ts',
      '+++ b/src/b.ts',
      '@@ -1 +1 @@',
      '+only line',
    ].join('\n');

    const ranges = parseChangedLineRanges(diff);

    expect(ranges.get('src/a.ts')).toEqual([
      { startLine: 11, endLine: 13 },
      { startLine: 53, endLine: 53 },
    ]);
    expect(ranges.get('src/b.ts')).toEqual([{ startLine: 1, endLine: 1 }]);
  });

  it('skips pure deletions (count of zero in the new file)', () => {
    const diff = [
      'diff --git a/src/c.ts b/src/c.ts',
      '--- a/src/c.ts',
      '+++ b/src/c.ts',
      '@@ -5,3 +4,0 @@',
      '-removed',
      '-removed',
      '-removed',
    ].join('\n');

    const ranges = parseChangedLineRanges(diff);

    expect(ranges.has('src/c.ts')).toBe(false);
  });

  it('ignores hunks for files deleted on the right side', () => {
    const diff = [
      'diff --git a/src/d.ts b/src/d.ts',
      'deleted file mode 100644',
      '--- a/src/d.ts',
      '+++ /dev/null',
      '@@ -1,3 +0,0 @@',
      '-line',
    ].join('\n');

    const ranges = parseChangedLineRanges(diff);

    expect(ranges.size).toBe(0);
  });

  it('returns an empty map for empty input', () => {
    expect(parseChangedLineRanges('').size).toBe(0);
  });
});

describe('createGitProvider.changedLineRanges', () => {
  it('shells out with --unified=0 and parses the result', async () => {
    const runner = new FakeProcessRunner();
    runner.enqueue({
      stdout: [
        'diff --git a/src/x.ts b/src/x.ts',
        '--- a/src/x.ts',
        '+++ b/src/x.ts',
        '@@ -2,0 +3,2 @@',
        '+a',
        '+b',
      ].join('\n'),
      stderr: '',
      exitCode: 0,
    });
    const git = createGitProvider(runner);

    const ranges = await git.changedLineRanges('/repo', 'main');

    expect(runner.calls[0]?.args).toEqual([
      'diff',
      '--unified=0',
      '--no-color',
      '--diff-filter=ACMRT',
      'main...HEAD',
    ]);
    expect(ranges.get('src/x.ts')).toEqual([{ startLine: 3, endLine: 4 }]);
  });
});

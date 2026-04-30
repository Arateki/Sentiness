import { asCheckId, asRuleId, type CheckResult, type Finding } from '@sentiness/check-sdk';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { RunOutcome } from '../runner/runner.js';
import type { BaselineSnapshot } from './baseline.js';
import { applyBaseline, applyBaselineToOutcome, compareMetrics } from './diff-filter.js';

const checkId = asCheckId('fake');
const ruleId = asRuleId('rule');

function makeFinding(fingerprint: string, file: string): Finding {
  return {
    id: `fake:${fingerprint}`,
    checkId,
    ruleId,
    severity: 'error',
    message: 'Fix this',
    location: { file },
    fingerprint,
  };
}

function makeBaseline(fingerprint: string): BaselineSnapshot {
  return makeBaselineFromFingerprints([fingerprint]);
}

function makeBaselineFromFingerprints(fingerprints: readonly string[]): BaselineSnapshot {
  return {
    schemaVersion: '1.0',
    createdAt: '2024-01-01T00:00:00.000Z',
    createdAtCommit: 'sha',
    suppressed: [...new Set(fingerprints)].map((fingerprint, index) => ({
      checkId,
      ruleId,
      fingerprint,
      location: { file: `src/baseline-${index}.ts` },
      addedAt: '2024-01-01T00:00:00.000Z',
      reason: 'existing issue',
    })),
    metrics: {},
  };
}

const fingerprintArbitrary = fc
  .integer({ min: 0, max: Number.MAX_SAFE_INTEGER })
  .map((value) => value.toString(16).padStart(64, '0'));
const fileArbitrary = fc.constantFrom('src/old.ts', 'src/new.ts', 'src/other.ts');
const findingArbitrary = fc
  .record({
    fingerprint: fingerprintArbitrary,
    file: fileArbitrary,
  })
  .map(({ fingerprint, file }) => makeFinding(fingerprint, file));
const changedFilesArbitrary = fc
  .array(fileArbitrary, { maxLength: 3 })
  .map((files) => [...new Set(files)]);

function makeOutcomeWithContext(
  result: CheckResult,
  changedFiles: readonly string[],
  diffOnly: boolean,
  changedRanges: Map<string, readonly { startLine: number; endLine: number }[]> = new Map(),
): RunOutcome {
  return {
    ...makeOutcome(result),
    context: {
      cwd: '/project',
      tier: 'fast',
      trigger: null,
      mode: diffOnly ? 'diff' : 'full',
      baseRef: diffOnly ? 'HEAD' : null,
      headRef: 'HEAD',
      changedFiles,
      changedRanges,
    },
  };
}

function resultFindings(outcome: RunOutcome): readonly Finding[] {
  return outcome.results.get(checkId)?.findings ?? [];
}

function makeOutcome(result: CheckResult): RunOutcome {
  return {
    runId: 'run',
    startedAt: '2024-01-01T00:00:00.000Z',
    completedAt: '2024-01-01T00:00:01.000Z',
    durationMs: 1000,
    results: new Map([[checkId, result]]),
    checkMetadata: new Map([[checkId, { category: 'lint' }]]),
    context: {
      cwd: '/project',
      tier: 'fast',
      trigger: null,
      mode: 'diff',
      baseRef: 'HEAD',
      headRef: 'HEAD',
      changedFiles: ['src/new.ts'],
      changedRanges: new Map(),
    },
  };
}

describe('diff-filter', () => {
  it('suppresses baseline findings and marks changed-file findings', () => {
    const oldFinding = makeFinding('a'.repeat(64), 'src/old.ts');
    const newFinding = makeFinding('b'.repeat(64), 'src/new.ts');
    const outsideDiffFinding = makeFinding('c'.repeat(64), 'src/other.ts');

    const filtered = applyBaseline(
      [oldFinding, newFinding, outsideDiffFinding],
      makeBaseline(oldFinding.fingerprint),
      ['src/new.ts'],
      false,
    );

    expect(filtered.suppressedCount).toBe(1);
    expect(filtered.findings).toEqual([
      { ...newFinding, introducedInDiff: true },
      { ...outsideDiffFinding, introducedInDiff: false },
    ]);
  });

  it('marks introducedInDiff only when the line is inside a changed hunk', () => {
    const insideHunk: Finding = {
      ...makeFinding('1'.repeat(64), 'src/new.ts'),
      location: { file: 'src/new.ts', startLine: 12 },
    };
    const outsideHunk: Finding = {
      ...makeFinding('2'.repeat(64), 'src/new.ts'),
      location: { file: 'src/new.ts', startLine: 80 },
    };
    const fileLevelOnly: Finding = {
      ...makeFinding('3'.repeat(64), 'src/new.ts'),
      // No startLine — falls back to file-level matching.
    };
    const ranges = new Map([
      [
        'src/new.ts',
        [
          { startLine: 10, endLine: 15 },
          { startLine: 40, endLine: 42 },
        ],
      ],
    ]);

    const filtered = applyBaseline(
      [insideHunk, outsideHunk, fileLevelOnly],
      undefined,
      ['src/new.ts'],
      false,
      ranges,
    );

    const flagsByFingerprint = new Map(
      filtered.findings.map((finding) => [finding.fingerprint, finding.introducedInDiff]),
    );
    expect(flagsByFingerprint.get(insideHunk.fingerprint)).toBe(true);
    expect(flagsByFingerprint.get(outsideHunk.fingerprint)).toBe(false);
    expect(flagsByFingerprint.get(fileLevelOnly.fingerprint)).toBe(true);
  });

  it('drops findings whose line is outside the changed hunks in diffOnly mode', () => {
    const insideHunk: Finding = {
      ...makeFinding('1'.repeat(64), 'src/new.ts'),
      location: { file: 'src/new.ts', startLine: 11 },
    };
    const outsideHunk: Finding = {
      ...makeFinding('2'.repeat(64), 'src/new.ts'),
      location: { file: 'src/new.ts', startLine: 200 },
    };
    const ranges = new Map([['src/new.ts', [{ startLine: 10, endLine: 15 }]]]);

    const filtered = applyBaseline(
      [insideHunk, outsideHunk],
      undefined,
      ['src/new.ts'],
      true,
      ranges,
    );

    expect(filtered.findings.map((finding) => finding.fingerprint)).toEqual([
      insideHunk.fingerprint,
    ]);
  });

  it('drops non-diff findings in diffOnly mode', () => {
    const changedFinding = makeFinding('b'.repeat(64), 'src/new.ts');
    const outsideDiffFinding = makeFinding('c'.repeat(64), 'src/other.ts');

    const filtered = applyBaseline(
      [changedFinding, outsideDiffFinding],
      undefined,
      ['src/new.ts'],
      true,
    );

    expect(filtered.findings).toEqual([{ ...changedFinding, introducedInDiff: true }]);
  });

  it('compares metrics in both directions', () => {
    expect(
      compareMetrics(
        { score: 90, duplicatedLines: 12 },
        {
          score: { value: 95, direction: 'higher-is-better' },
          duplicatedLines: { value: 10, direction: 'lower-is-better' },
        },
      ),
    ).toEqual([
      { metric: 'score', baselineValue: 95, currentValue: 90, direction: 'higher-is-better' },
      {
        metric: 'duplicatedLines',
        baselineValue: 10,
        currentValue: 12,
        direction: 'lower-is-better',
      },
    ]);
  });

  it('clears all findings in trend mode and still computes metric regressions', () => {
    const finding = makeFinding('b'.repeat(64), 'src/new.ts');
    const result: CheckResult = {
      status: 'violations',
      findings: [finding],
      durationMs: 1,
      metrics: { score: 70 },
    };
    const trendOutcome: RunOutcome = {
      ...makeOutcome(result),
      context: {
        cwd: '/project',
        tier: 'standard',
        trigger: null,
        mode: 'trend',
        baseRef: null,
        headRef: 'HEAD',
        changedFiles: [],
        changedRanges: new Map(),
      },
    };
    const baseline = {
      ...makeBaseline('a'.repeat(64)),
      suppressed: [],
      metrics: { 'fake.score': { value: 90, direction: 'higher-is-better' as const } },
    };

    const application = applyBaselineToOutcome(trendOutcome, baseline, {
      baselinePath: '/project/.sentiness/baseline.json',
      diffOnly: false,
    });

    expect(application.outcome.results.get(checkId)?.findings).toEqual([]);
    expect(application.suppressedCount).toBe(0);
    expect(application.baselineApplied).toBe(true);
    expect(application.baselineMode).toBe('metrics-only');
    expect(application.metricRegressions).toEqual([
      { metric: 'fake.score', baselineValue: 90, currentValue: 70, direction: 'higher-is-better' },
    ]);
  });

  it('adds metric regressions when applying a baseline to an outcome', () => {
    const result: CheckResult = {
      status: 'ok',
      findings: [],
      durationMs: 1,
      metrics: { score: 80 },
    };
    const baseline = {
      ...makeBaseline('a'.repeat(64)),
      suppressed: [],
      metrics: { 'fake.score': { value: 90, direction: 'higher-is-better' as const } },
    };

    const application = applyBaselineToOutcome(makeOutcome(result), baseline, {
      baselinePath: '/project/.sentiness/baseline.json',
      diffOnly: false,
    });

    expect(application.metricRegressions).toEqual([
      { metric: 'fake.score', baselineValue: 90, currentValue: 80, direction: 'higher-is-better' },
    ]);
  });

  it('is idempotent when applying a baseline to already-filtered findings', () => {
    fc.assert(
      fc.property(
        fc.array(findingArbitrary, { maxLength: 12 }),
        fc.array(fingerprintArbitrary, { maxLength: 8 }),
        changedFilesArbitrary,
        fc.boolean(),
        (findings, suppressedFingerprints, changedFiles, diffOnly) => {
          const baseline = makeBaselineFromFingerprints(suppressedFingerprints);
          const once = applyBaseline(findings, baseline, changedFiles, diffOnly);
          const twice = applyBaseline(once.findings, baseline, changedFiles, diffOnly);

          expect(twice.findings).toEqual(once.findings);
          expect(twice.suppressedCount).toBe(0);
          expect(twice.newInDiff).toEqual(once.newInDiff);
        },
      ),
    );
  });

  it('is idempotent when applying a baseline to an already-filtered outcome', () => {
    fc.assert(
      fc.property(
        fc.array(findingArbitrary, { maxLength: 12 }),
        fc.array(fingerprintArbitrary, { maxLength: 8 }),
        changedFilesArbitrary,
        fc.boolean(),
        (findings, suppressedFingerprints, changedFiles, diffOnly) => {
          const baseline = makeBaselineFromFingerprints(suppressedFingerprints);
          const result: CheckResult = {
            status: findings.length > 0 ? 'violations' : 'ok',
            findings,
            durationMs: 1,
          };
          const outcome = makeOutcomeWithContext(result, changedFiles, diffOnly);
          const once = applyBaselineToOutcome(outcome, baseline, {
            baselinePath: '/project/.sentiness/baseline.json',
            diffOnly,
          });
          const twice = applyBaselineToOutcome(once.outcome, baseline, {
            baselinePath: '/project/.sentiness/baseline.json',
            diffOnly,
          });

          expect(resultFindings(twice.outcome)).toEqual(resultFindings(once.outcome));
          expect(twice.suppressedCount).toBe(0);
          expect(twice.metricRegressions).toEqual(once.metricRegressions);
        },
      ),
    );
  });
});

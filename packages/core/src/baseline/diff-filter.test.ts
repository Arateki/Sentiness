import { asCheckId, asRuleId, type CheckResult, type Finding } from '@sentiness/check-sdk';
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
  return {
    schemaVersion: '1.0',
    createdAt: '2024-01-01T00:00:00.000Z',
    createdAtCommit: 'sha',
    suppressed: [
      {
        checkId,
        ruleId,
        fingerprint,
        location: { file: 'src/old.ts' },
        addedAt: '2024-01-01T00:00:00.000Z',
        reason: 'existing issue',
      },
    ],
    metrics: {},
  };
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
    expect(application.baselineApplied).toBe(false);
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
});

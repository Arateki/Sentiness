import type { CheckMetrics, CheckResult, Finding } from '@sentiness/check-sdk';
import type { RunOutcome } from '../runner/runner.js';
import type { BaselineSnapshot, MetricBaseline } from './baseline.js';

export type MetricRegression = {
  readonly metric: string;
  readonly baselineValue: number;
  readonly currentValue: number;
  readonly direction: 'higher-is-better' | 'lower-is-better';
};

export type FilterResult = {
  readonly findings: readonly Finding[];
  readonly suppressedCount: number;
  readonly newInDiff: readonly Finding[];
};

export type BaselineApplication = {
  readonly outcome: RunOutcome;
  readonly baselineApplied: boolean;
  readonly baselinePath: string | null;
  readonly suppressedCount: number;
  readonly metricRegressions: readonly MetricRegression[];
};

function suppressedFingerprints(baseline: BaselineSnapshot | undefined): ReadonlySet<string> {
  return new Set((baseline?.suppressed ?? []).map((entry) => entry.fingerprint));
}

function tagFinding(finding: Finding, introducedInDiff: boolean): Finding {
  return { ...finding, introducedInDiff };
}

export function applyBaseline(
  findings: readonly Finding[],
  baseline: BaselineSnapshot | undefined,
  changedFiles: readonly string[],
  diffOnly: boolean,
): FilterResult {
  const suppressed = suppressedFingerprints(baseline);
  const changed = new Set(changedFiles);
  const kept: Finding[] = [];
  let suppressedCount = 0;

  for (const finding of findings) {
    if (suppressed.has(finding.fingerprint)) {
      suppressedCount += 1;
      continue;
    }
    const introducedInDiff = changed.has(finding.location.file);
    if (diffOnly && !introducedInDiff) {
      continue;
    }
    kept.push(tagFinding(finding, introducedInDiff));
  }

  return {
    findings: kept,
    suppressedCount,
    newInDiff: kept.filter((finding) => finding.introducedInDiff === true),
  };
}

export function compareMetrics(
  current: CheckMetrics,
  baseline: Readonly<Record<string, MetricBaseline>>,
): readonly MetricRegression[] {
  const regressions: MetricRegression[] = [];
  for (const [metric, baselineValue] of Object.entries(baseline)) {
    const currentValue = current[metric];
    if (typeof currentValue !== 'number') {
      continue;
    }
    const isRegression =
      baselineValue.direction === 'higher-is-better'
        ? currentValue < baselineValue.value
        : currentValue > baselineValue.value;
    if (isRegression) {
      regressions.push({
        metric,
        baselineValue: baselineValue.value,
        currentValue,
        direction: baselineValue.direction,
      });
    }
  }
  return regressions;
}

function resultWithFindings(result: CheckResult, findings: readonly Finding[]): CheckResult {
  const status =
    result.status === 'error' || result.status === 'skipped'
      ? result.status
      : findings.length > 0
        ? 'violations'
        : 'ok';
  return { ...result, status, findings };
}

export function applyBaselineToOutcome(
  outcome: RunOutcome,
  baseline: BaselineSnapshot | undefined,
  options: { readonly baselinePath: string | null; readonly diffOnly: boolean },
): BaselineApplication {
  const results = new Map(outcome.results);
  let suppressedCount = 0;
  for (const [checkId, result] of outcome.results) {
    const filtered = applyBaseline(
      result.findings,
      baseline,
      outcome.context.changedFiles,
      options.diffOnly,
    );
    suppressedCount += filtered.suppressedCount;
    results.set(checkId, resultWithFindings(result, filtered.findings));
  }

  return {
    outcome: { ...outcome, results, checkMetadata: outcome.checkMetadata },
    baselineApplied: baseline !== undefined,
    baselinePath: options.baselinePath,
    suppressedCount,
    metricRegressions: [],
  };
}

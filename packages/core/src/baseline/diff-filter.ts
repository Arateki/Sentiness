import type {
  Category,
  ChangedLineRanges,
  CheckMetrics,
  CheckResult,
  Finding,
  LineRange,
} from '@sentiness/check-sdk';
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

export type BaselineMode = 'suppress' | 'metrics-only' | 'none';

export type BaselineApplication = {
  readonly outcome: RunOutcome;
  readonly baselineApplied: boolean;
  readonly baselineMode: BaselineMode;
  readonly baselinePath: string | null;
  readonly suppressedCount: number;
  readonly metricRegressions: readonly MetricRegression[];
};

// Security advisories appear over time without the code changing, and platform
// results signal Sentiness's own failures; neither is caused by the current
// patch, so the diff filter never drops them. The baseline — not the diff
// filter — is the mechanism for accepting known findings in these categories.
const DIFF_DROP_EXEMPT_CATEGORIES: ReadonlySet<Category> = new Set(['security', 'platform']);

function suppressedFingerprints(baseline: BaselineSnapshot | undefined): ReadonlySet<string> {
  return new Set((baseline?.suppressed ?? []).map((entry) => entry.fingerprint));
}

function tagFinding(finding: Finding, introducedInDiff: boolean): Finding {
  return { ...finding, introducedInDiff };
}

function lineWithinRanges(line: number, ranges: readonly LineRange[]): boolean {
  for (const range of ranges) {
    if (line >= range.startLine && line <= range.endLine) {
      return true;
    }
  }
  return false;
}

function isFindingInDiff(
  finding: Finding,
  changedFiles: ReadonlySet<string>,
  changedRanges: ChangedLineRanges,
): boolean {
  const fileInDiff = changedFiles.has(finding.location.file);
  if (!fileInDiff) {
    return false;
  }
  const ranges = changedRanges.get(finding.location.file);
  // If we have ranges for this file and the finding has a precise line,
  // restrict the match to lines actually inside a hunk.
  if (ranges && ranges.length > 0 && typeof finding.location.startLine === 'number') {
    return lineWithinRanges(finding.location.startLine, ranges);
  }
  // No precise line available (e.g. dependency findings) — fall back to file-level.
  return true;
}

export function applyBaseline(
  findings: readonly Finding[],
  baseline: BaselineSnapshot | undefined,
  changedFiles: readonly string[],
  diffOnly: boolean,
  changedRanges: ChangedLineRanges = new Map(),
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
    const introducedInDiff = isFindingInDiff(finding, changed, changedRanges);
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

function collectCurrentMetrics(outcome: RunOutcome): CheckMetrics {
  const metrics: Record<string, number | string | boolean> = {};
  for (const [checkId, result] of outcome.results) {
    for (const [name, value] of Object.entries(result.metrics ?? {})) {
      metrics[`${checkId}.${name}`] = value;
    }
  }
  return metrics;
}

export function applyBaselineToOutcome(
  outcome: RunOutcome,
  baseline: BaselineSnapshot | undefined,
  options: { readonly baselinePath: string | null; readonly diffOnly: boolean },
): BaselineApplication {
  const isTrend = outcome.context.mode === 'trend';
  const results = new Map(outcome.results);
  let suppressedCount = 0;

  for (const [checkId, result] of outcome.results) {
    if (isTrend) {
      // In trend mode, suppress all findings — only metric regressions are surfaced.
      // Metrics are preserved on the original result for compareMetrics below.
      results.set(checkId, resultWithFindings(result, []));
    } else {
      const category = outcome.checkMetadata.get(checkId)?.category;
      const dropOutOfDiff =
        options.diffOnly && !(category !== undefined && DIFF_DROP_EXEMPT_CATEGORIES.has(category));
      const filtered = applyBaseline(
        result.findings,
        baseline,
        outcome.context.changedFiles,
        dropOutOfDiff,
        outcome.context.changedRanges,
      );
      suppressedCount += filtered.suppressedCount;
      results.set(checkId, resultWithFindings(result, filtered.findings));
    }
  }

  const baselineMode: BaselineMode =
    baseline === undefined ? 'none' : isTrend ? 'metrics-only' : 'suppress';

  return {
    outcome: { ...outcome, results, checkMetadata: outcome.checkMetadata },
    baselineApplied: baseline !== undefined,
    baselineMode,
    baselinePath: options.baselinePath,
    suppressedCount,
    metricRegressions: baseline
      ? compareMetrics(collectCurrentMetrics(outcome), baseline.metrics)
      : [],
  };
}

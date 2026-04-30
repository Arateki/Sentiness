import { type CheckId, compareSeverity, type Finding, type Severity } from '@sentiness/check-sdk';
import type { BaselineMode, MetricRegression } from '../baseline/diff-filter.js';
import type { ResolvedConfig } from '../config/config.js';
import type { RunOutcome } from '../runner/runner.js';
import { type Report, ReportSchema } from '../schema/report.js';
import { SENTINESS_VERSION } from '../version.js';
import { buildAgentInstructions, type ErroredCheck } from './agent-instructions.js';

export type ReporterOptions = {
  readonly compact: boolean;
  readonly omitOk: boolean;
  readonly maxFindingsPerCheck?: number;
};

export type ReportInput = {
  readonly outcome: RunOutcome;
  readonly baselineApplied: boolean;
  readonly baselineMode: BaselineMode;
  readonly baselinePath: string | null;
  readonly suppressedCount: number;
  readonly metricRegressions: readonly MetricRegression[];
};

type Counts = Record<Severity, number>;

function emptyCounts(): Counts {
  return { error: 0, warning: 0, info: 0 };
}

function countFindings(findings: readonly Finding[]): Counts {
  const counts = emptyCounts();
  for (const finding of findings) {
    counts[finding.severity] += 1;
  }
  return counts;
}

function allFindings(outcome: RunOutcome): readonly Finding[] {
  return [...outcome.results.values()].flatMap((result) => result.findings);
}

function dependencyNames(findings: readonly Finding[], ruleId: string): readonly string[] {
  return findings
    .filter((finding) => finding.ruleId === ruleId)
    .map((finding) => finding.location.packageName)
    .filter((name): name is string => typeof name === 'string');
}

function truncateFindings(
  findings: readonly Finding[],
  maxFindings: number,
): {
  readonly findings: readonly Finding[];
  readonly truncated?: { readonly total: number; readonly shown: number };
} {
  if (findings.length <= maxFindings) {
    return { findings };
  }
  const sorted = [...findings].sort((left, right) => {
    const severity = compareSeverity(left.severity, right.severity);
    if (severity !== 0) {
      return severity;
    }
    return left.location.file.localeCompare(right.location.file);
  });
  return {
    findings: sorted.slice(0, maxFindings),
    truncated: { total: findings.length, shown: maxFindings },
  };
}

function findingForReport(finding: Finding): Report['checks'][number]['findings'][number] {
  return {
    id: finding.id,
    checkId: finding.checkId,
    ruleId: finding.ruleId,
    severity: finding.severity,
    message: finding.message,
    location: finding.location,
    ...(finding.snippet ? { snippet: finding.snippet } : {}),
    ...(finding.suggestion ? { suggestion: finding.suggestion } : {}),
    ...(finding.references ? { references: [...finding.references] } : {}),
    fingerprint: finding.fingerprint,
    ...(finding.introducedInDiff !== undefined
      ? { introducedInDiff: finding.introducedInDiff }
      : {}),
  };
}

function checkEntry(
  input: ReportInput,
  checkId: CheckId,
  maxFindings: number,
): Report['checks'][number] {
  const result = input.outcome.results.get(checkId);
  if (!result) {
    throw new Error(`Missing result for ${checkId}`);
  }
  const metadata = input.outcome.checkMetadata.get(checkId);
  const truncated = truncateFindings(result.findings, maxFindings);
  return {
    id: checkId,
    category: metadata?.category ?? 'platform',
    status: result.status,
    durationMs: result.durationMs,
    ...(result.metrics ? { metrics: result.metrics } : {}),
    findings: truncated.findings.map(findingForReport),
    ...(result.skipReason ? { skipReason: result.skipReason } : {}),
    ...(result.errorMessage ? { errorMessage: result.errorMessage } : {}),
    ...(truncated.truncated ? { truncated: truncated.truncated } : {}),
  };
}

export function buildReport(
  input: ReportInput,
  config: ResolvedConfig,
  options: ReporterOptions,
): Report {
  const maxFindings = options.maxFindingsPerCheck ?? 50;
  const findings = allFindings(input.outcome);
  const totals = countFindings(findings);
  const newInDiff = countFindings(findings.filter((finding) => finding.introducedInDiff === true));
  const checks = [...input.outcome.results.keys()].map((checkId) =>
    checkEntry(input, checkId, maxFindings),
  );
  const visibleChecks =
    options.compact || options.omitOk
      ? checks.filter((check) => check.status !== 'ok' || check.findings.length > 0)
      : checks;
  const checksErrored = checks.filter((check) => check.status === 'error').length;
  const status = checksErrored > 0 ? 'error' : findings.length > 0 ? 'violations' : 'ok';
  const erroredCheckDetails: readonly ErroredCheck[] = checks
    .filter((check) => check.status === 'error')
    .map((check) => ({
      id: check.id,
      ...(check.errorMessage !== undefined ? { errorMessage: check.errorMessage } : {}),
    }));
  const instructions = buildAgentInstructions(
    findings,
    config.reporting.warningsAreErrors,
    erroredCheckDetails,
  );

  return ReportSchema.parse({
    schemaVersion: '1.0',
    sentinessVersion: SENTINESS_VERSION,
    runId: input.outcome.runId,
    startedAt: input.outcome.startedAt,
    completedAt: input.outcome.completedAt,
    durationMs: input.outcome.durationMs,
    context: {
      cwd: input.outcome.context.cwd,
      tier: input.outcome.context.tier,
      trigger: input.outcome.context.trigger,
      mode: input.outcome.context.mode,
      baseRef: input.outcome.context.baseRef,
      headRef: input.outcome.context.headRef,
      changedFiles: input.outcome.context.changedFiles,
      addedDependencies: dependencyNames(findings, 'new-dependency'),
      removedDependencies: dependencyNames(findings, 'removed-dependency'),
    },
    summary: {
      status,
      totals,
      newInDiff,
      blocking: instructions.blocking,
      topIssues: instructions.mustFix.slice(0, 5),
      checksRun: checks.filter((check) => check.status !== 'skipped').length,
      checksSkipped: checks.filter((check) => check.status === 'skipped').length,
      checksErrored,
    },
    checks: visibleChecks,
    trend:
      input.metricRegressions.length > 0
        ? { available: true, regressions: input.metricRegressions }
        : { available: false, reason: 'no metric baseline regressions' },
    baseline: {
      applied: input.baselineApplied,
      mode: input.baselineMode,
      path: input.baselinePath ?? '',
      suppressedFindings: input.suppressedCount,
    },
    agentInstructions: instructions,
  });
}

export function exitCodeFor(report: Report): 0 | 1 | 2 | 3 {
  if (report.summary.status === 'error') {
    return 3;
  }
  if (!report.summary.blocking) {
    return 0;
  }
  if (report.summary.totals.error > 0) {
    return 1;
  }
  return 2;
}

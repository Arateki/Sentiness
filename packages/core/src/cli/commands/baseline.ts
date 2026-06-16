import { isAbsolute, join } from 'node:path';
import type { CheckId, CheckResult, Finding, Tier } from '@sentiness/check-sdk';
import {
  BaselineManager,
  type BaselineSnapshot,
  collectMetricBaselines,
} from '../../baseline/baseline.js';
import { loadConfig, type ResolvedConfig } from '../../config/config.js';
import type { CheckRegistry } from '../../registry/registry.js';
import { type RunInput, type RunOutcome, runChecks } from '../../runner/runner.js';
import { buildRegistry } from './build-registry.js';
import type { CommandDeps, ParsedArgs } from './types.js';

function resolvePath(cwd: string, path: string): string {
  return isAbsolute(path) ? path : join(cwd, path);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

const allTiers = ['fast', 'standard', 'slow'] as const satisfies readonly Tier[];

function runInput(config: ResolvedConfig, registry: CheckRegistry, deps: CommandDeps): RunInput {
  return {
    registry,
    config,
    cwd: deps.cwd,
    fs: deps.fs,
    process: deps.processRunner,
    logger: deps.logger,
    clock: deps.clock,
    git: deps.git,
  };
}

async function runTier(
  config: ResolvedConfig,
  registry: CheckRegistry,
  deps: CommandDeps,
  tier: Tier,
): Promise<RunOutcome> {
  return runChecks(runInput(config, registry, deps), { tier, diffOnly: false });
}

function mergeStatus(
  left: CheckResult['status'],
  right: CheckResult['status'],
): CheckResult['status'] {
  const rank: Readonly<Record<CheckResult['status'], number>> = {
    error: 4,
    violations: 3,
    skipped: 2,
    ok: 1,
  };
  return rank[right] > rank[left] ? right : left;
}

// Invariant: a given check id should only appear in one tier (its defaultTier or configured tier).
// mergeCheckResult is called when the same id appears in multiple runTier outcomes, which should
// not happen in practice. If Phase H introduces a check that appears in multiple tiers, resolve
// the conflict explicitly rather than relying on this spread-merge.
function mergeCheckResult(left: CheckResult, right: CheckResult): CheckResult {
  const metrics =
    left.metrics || right.metrics ? { ...(left.metrics ?? {}), ...(right.metrics ?? {}) } : null;
  const errorMessage = left.errorMessage ?? right.errorMessage;
  const skipReason = left.skipReason ?? right.skipReason;

  return {
    ...left,
    status: mergeStatus(left.status, right.status),
    findings: [...left.findings, ...right.findings],
    durationMs: left.durationMs + right.durationMs,
    ...(metrics ? { metrics } : {}),
    ...(errorMessage ? { errorMessage } : {}),
    ...(skipReason ? { skipReason } : {}),
  };
}

function mergeOutcomes(left: RunOutcome, right: RunOutcome): RunOutcome {
  const results: Map<CheckId, CheckResult> = new Map(left.results);
  for (const [checkId, result] of right.results) {
    const existing = results.get(checkId);
    results.set(checkId, existing ? mergeCheckResult(existing, result) : result);
  }

  return {
    ...left,
    results,
    checkMetadata: new Map([...left.checkMetadata, ...right.checkMetadata]),
    completedAt: right.completedAt,
    durationMs: left.durationMs + right.durationMs,
  };
}

async function runAllTiers(
  config: ResolvedConfig,
  registry: CheckRegistry,
  deps: CommandDeps,
): Promise<RunOutcome> {
  let mergedOutcome: RunOutcome | undefined;

  for (const tier of allTiers) {
    const outcome = await runTier(config, registry, deps, tier);
    mergedOutcome = mergedOutcome ? mergeOutcomes(mergedOutcome, outcome) : outcome;
  }

  if (!mergedOutcome) {
    throw new Error('No tiers configured for baseline run');
  }
  return mergedOutcome;
}

function allFindings(outcome: RunOutcome): readonly Finding[] {
  return [...outcome.results.values()].flatMap((result) => result.findings);
}

async function findFindingByFingerprint(
  config: ResolvedConfig,
  registry: CheckRegistry,
  deps: CommandDeps,
  fingerprint: string,
  tier: Tier = 'fast',
): Promise<Finding | undefined> {
  const outcome = await runTier(config, registry, deps, tier);
  return allFindings(outcome).find((finding) => finding.fingerprint === fingerprint);
}

function tierRetrySuggestion(tier: Tier): string {
  const alternatives = allTiers.filter((candidate) => candidate !== tier);
  if (alternatives.length === 0) {
    return '';
  }
  return ` Try ${alternatives.map((candidate) => `--tier=${candidate}`).join(' or ')} if the finding belongs to another tier.`;
}

export async function baselineInitCommand(_args: ParsedArgs, deps: CommandDeps): Promise<number> {
  const config = await loadConfig(deps.cwd, deps.fs);
  const registry = await buildRegistry(config, deps);
  const baselinePath = resolvePath(deps.cwd, config.baseline.path);
  const mergedOutcome = await runAllTiers(config, registry, deps);

  const snapshot = await BaselineManager.createFromOutcome(mergedOutcome, deps.git, deps.cwd);
  await BaselineManager.save(baselinePath, snapshot, deps.fs);

  deps.logger.info(
    `Baseline initialized at ${config.baseline.path} with ${snapshot.suppressed.length} findings.`,
  );
  return 0;
}

export async function baselineUpdateCommand(args: ParsedArgs, deps: CommandDeps): Promise<number> {
  const config = await loadConfig(deps.cwd, deps.fs);
  const baselinePath = resolvePath(deps.cwd, config.baseline.path);
  const existing = await BaselineManager.load(baselinePath, deps.fs);
  if (!existing) {
    deps.logger.error('No baseline found. Run `sentiness baseline init` first.');
    return 1;
  }

  const registry = await buildRegistry(config, deps);
  const targetMetric = optionalString(args.metric);
  const forceUpdate = args.force === true;

  const currentMetrics = collectMetricBaselines(await runAllTiers(config, registry, deps));

  const updatedMetrics = { ...existing.metrics };
  let updatedCount = 0;
  let hasBlockingRegression = false;

  for (const [metricKey, currentMetric] of Object.entries(currentMetrics)) {
    if (targetMetric && metricKey !== targetMetric) {
      continue; // Skip if a specific metric was requested and this is not it.
    }

    const baselineMetric = existing.metrics[metricKey];
    if (!baselineMetric) {
      // New metric, add it to baseline
      updatedMetrics[metricKey] = currentMetric;
      updatedCount++;
      continue;
    }

    // Ratchet: only update when the metric improved
    const improved =
      baselineMetric.direction === 'higher-is-better'
        ? currentMetric.value > baselineMetric.value
        : currentMetric.value < baselineMetric.value;

    if (improved) {
      updatedMetrics[metricKey] = { ...baselineMetric, value: currentMetric.value };
      updatedCount++;
    } else if (targetMetric === metricKey) {
      // User specifically targeted this metric but it regressed
      if (forceUpdate) {
        deps.logger.warn(
          `Forcing metric "${metricKey}" to regress: ${baselineMetric.value} → ${currentMetric.value}. This is non-idempotent and may hide real regressions.`,
        );
        updatedMetrics[metricKey] = { ...baselineMetric, value: currentMetric.value };
        updatedCount++;
      } else {
        deps.logger.warn(
          `Metric "${metricKey}" regressed from ${baselineMetric.value} to ${currentMetric.value}. Use --force to override.`,
        );
        hasBlockingRegression = true;
      }
    }
  }

  if (hasBlockingRegression) {
    return 1;
  }

  if (updatedCount > 0) {
    const updatedSnapshot: BaselineSnapshot = {
      ...existing,
      metrics: updatedMetrics,
    };
    await BaselineManager.save(baselinePath, updatedSnapshot, deps.fs);
    deps.logger.info(`Baseline metrics updated: ${updatedCount} metrics changed.`);
  } else {
    deps.logger.info('No metrics improved; baseline unchanged.');
  }

  return 0;
}

export async function baselineAcceptCommand(args: ParsedArgs, deps: CommandDeps): Promise<number> {
  const config = await loadConfig(deps.cwd, deps.fs);
  const baselinePath = resolvePath(deps.cwd, config.baseline.path);
  const existing = await BaselineManager.load(baselinePath, deps.fs);
  if (!existing) {
    deps.logger.error('No baseline found. Run `sentiness baseline init` first.');
    return 1;
  }

  const fingerprint = optionalString(args.fingerprint);
  const reason = optionalString(args.reason);

  if (!fingerprint) {
    deps.logger.error('--fingerprint is required');
    return 1;
  }
  if (!reason || reason.trim().length === 0) {
    deps.logger.error('--reason is required');
    return 1;
  }

  const registry = await buildRegistry(config, deps);
  const parsedTier = optionalString(args.tier);
  const acceptTier: Tier =
    parsedTier === 'fast' || parsedTier === 'standard' || parsedTier === 'slow'
      ? parsedTier
      : 'fast';
  const targetFinding = await findFindingByFingerprint(
    config,
    registry,
    deps,
    fingerprint,
    acceptTier,
  );

  if (!targetFinding) {
    deps.logger.warn(`Finding with fingerprint ${fingerprint} not found in tier "${acceptTier}".`);
    deps.logger.error(
      `Finding with fingerprint ${fingerprint} not found in current "${acceptTier}" run.${tierRetrySuggestion(acceptTier)}`,
    );
    return 1;
  }

  try {
    const updatedSnapshot = BaselineManager.accept(existing, targetFinding, reason, deps.clock);
    await BaselineManager.save(baselinePath, updatedSnapshot, deps.fs);
    deps.logger.info(`Accepted finding ${fingerprint} into baseline.`);
    return 0;
  } catch (error) {
    deps.logger.error(error instanceof Error ? error.message : 'Failed to accept finding');
    return 1;
  }
}

export async function baselinePruneCommand(_args: ParsedArgs, deps: CommandDeps): Promise<number> {
  const config = await loadConfig(deps.cwd, deps.fs);
  const baselinePath = resolvePath(deps.cwd, config.baseline.path);
  const existing = await BaselineManager.load(baselinePath, deps.fs);
  if (!existing) {
    deps.logger.error('No baseline found. Run `sentiness baseline init` first.');
    return 1;
  }

  const registry = await buildRegistry(config, deps);

  const currentFingerprints = new Set(
    allFindings(await runAllTiers(config, registry, deps)).map((finding) => finding.fingerprint),
  );

  const updatedSnapshot = BaselineManager.prune(existing, currentFingerprints);
  await BaselineManager.save(baselinePath, updatedSnapshot, deps.fs);

  const prunedCount = existing.suppressed.length - updatedSnapshot.suppressed.length;
  deps.logger.info(`Baseline pruned. Removed ${prunedCount} obsolete entries.`);
  return 0;
}

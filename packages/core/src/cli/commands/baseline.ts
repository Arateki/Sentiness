import { isAbsolute, join } from 'node:path';
import type { CheckId, CheckResult, Finding } from '@sentiness/check-sdk';
import {
  BaselineManager,
  type BaselineSnapshot,
  type MetricBaseline,
} from '../../baseline/baseline.js';
import { loadConfig } from '../../config/config.js';
import { CheckRegistry } from '../../registry/registry.js';
import { type RunOutcome, runChecks } from '../../runner/runner.js';
import type { CommandDeps, ParsedArgs } from './types.js';

function resolvePath(cwd: string, path: string): string {
  return isAbsolute(path) ? path : join(cwd, path);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export async function baselineInitCommand(_args: ParsedArgs, deps: CommandDeps): Promise<number> {
  const config = await loadConfig(deps.cwd, deps.fs);
  const registry = await CheckRegistry.fromConfig(config, deps.cwd);
  const baselinePath = resolvePath(deps.cwd, config.baseline.path);

  // According to spec: baseline init runs all enabled checks across all tiers
  // with no baseline applied, then writes BaselineSnapshot from the resulting findings + metrics.
  // "This can be implemented as one all-tiers helper or as three runChecks invocations merged into one RunOutcome."
  // It's simpler to run a full check since runner currently takes a single tier,
  // but if tier is not provided it defaults to 'standard'. We actually need to collect findings
  // from all tiers.

  // Let's run for all three tiers and merge the outcomes.
  const tiers: Array<'fast' | 'standard' | 'slow'> = ['fast', 'standard', 'slow'];
  let mergedOutcome: RunOutcome | null = null; // Will build a composite outcome

  for (const tier of tiers) {
    const outcome = await runChecks(
      {
        registry,
        config,
        cwd: deps.cwd,
        fs: deps.fs,
        process: deps.processRunner,
        logger: deps.logger,
        clock: deps.clock,
        git: deps.git,
      },
      { tier, diffOnly: false },
    );
    if (!mergedOutcome) {
      mergedOutcome = { ...outcome, results: new Map(outcome.results) };
    } else {
      const newResults = new Map<CheckId, CheckResult>(mergedOutcome.results);
      for (const [checkId, result] of outcome.results) {
        const existing = newResults.get(checkId);
        if (!existing) {
          newResults.set(checkId, result);
        } else {
          // Merge findings and metrics if the check ran multiple times (e.g. overriden in multiple tiers, which shouldn't happen by spec, but safe fallback)
          newResults.set(checkId, {
            ...existing,
            findings: [...existing.findings, ...result.findings],
            metrics: { ...(existing.metrics ?? {}), ...(result.metrics ?? {}) },
          });
        }
      }
      mergedOutcome = { ...mergedOutcome, results: newResults } as RunOutcome;
    }
  }

  if (!mergedOutcome) {
    return 1;
  }

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

  const registry = await CheckRegistry.fromConfig(config, deps.cwd);
  const targetMetric = optionalString(args.metric);

  // Re-run checks to gather current metrics. Since metrics can be from any tier, we run all.
  const tiers: Array<'fast' | 'standard' | 'slow'> = ['fast', 'standard', 'slow'];
  const currentMetrics: Record<string, MetricBaseline> = {};

  for (const tier of tiers) {
    const outcome = await runChecks(
      {
        registry,
        config,
        cwd: deps.cwd,
        fs: deps.fs,
        process: deps.processRunner,
        logger: deps.logger,
        clock: deps.clock,
        git: deps.git,
      },
      { tier, diffOnly: false },
    );

    // Collect metrics from outcome
    for (const [checkId, result] of outcome.results) {
      for (const [name, value] of Object.entries(result.metrics ?? {})) {
        if (typeof value === 'number') {
          currentMetrics[`${checkId}.${name}`] = { value, direction: 'higher-is-better' }; // default direction
        }
      }
    }
  }

  const updatedMetrics = { ...existing.metrics };
  let updatedCount = 0;

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

    // Check for improvement (ratchet)
    const improved =
      baselineMetric.direction === 'higher-is-better'
        ? currentMetric.value > baselineMetric.value
        : currentMetric.value < baselineMetric.value;

    if (improved || targetMetric === metricKey) {
      updatedMetrics[metricKey] = { ...baselineMetric, value: currentMetric.value };
      updatedCount++;
    }
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

  const registry = await CheckRegistry.fromConfig(config, deps.cwd);

  // Need to find the finding. Run all checks.
  const tiers: Array<'fast' | 'standard' | 'slow'> = ['fast', 'standard', 'slow'];
  let targetFinding: Finding | null = null;

  for (const tier of tiers) {
    if (targetFinding) break;
    const outcome = await runChecks(
      {
        registry,
        config,
        cwd: deps.cwd,
        fs: deps.fs,
        process: deps.processRunner,
        logger: deps.logger,
        clock: deps.clock,
        git: deps.git,
      },
      { tier, diffOnly: false },
    );
    for (const result of outcome.results.values()) {
      const match = result.findings.find((f) => f.fingerprint === fingerprint);
      if (match) {
        targetFinding = match;
        break;
      }
    }
  }

  if (!targetFinding) {
    deps.logger.error(`Finding with fingerprint ${fingerprint} not found in current run.`);
    return 1;
  }

  try {
    const updatedSnapshot = BaselineManager.accept(existing, targetFinding, reason);
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

  const registry = await CheckRegistry.fromConfig(config, deps.cwd);

  // Gather all current fingerprints
  const tiers: Array<'fast' | 'standard' | 'slow'> = ['fast', 'standard', 'slow'];
  const currentFingerprints = new Set<string>();

  for (const tier of tiers) {
    const outcome = await runChecks(
      {
        registry,
        config,
        cwd: deps.cwd,
        fs: deps.fs,
        process: deps.processRunner,
        logger: deps.logger,
        clock: deps.clock,
        git: deps.git,
      },
      { tier, diffOnly: false },
    );
    for (const result of outcome.results.values()) {
      for (const finding of result.findings) {
        currentFingerprints.add(finding.fingerprint);
      }
    }
  }

  const updatedSnapshot = BaselineManager.prune(existing, currentFingerprints);
  await BaselineManager.save(baselinePath, updatedSnapshot, deps.fs);

  const prunedCount = existing.suppressed.length - updatedSnapshot.suppressed.length;
  deps.logger.info(`Baseline pruned. Removed ${prunedCount} obsolete entries.`);
  return 0;
}

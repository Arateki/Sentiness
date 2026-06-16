import { randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join } from 'node:path';
import type { Tier } from '@sentiness/check-sdk';
import { BaselineManager } from '../../baseline/baseline.js';
import { applyBaselineToOutcome } from '../../baseline/diff-filter.js';
import { loadConfig, type ResolvedConfig } from '../../config/config.js';
import { JobSpawner } from '../../jobs/spawner.js';
import { PendingQueue } from '../../pending/pending.js';
import { buildReport, exitCodeFor } from '../../reporter/reporter.js';
import { runChecks } from '../../runner/runner.js';
import { buildRegistry } from './build-registry.js';
import type { CommandDeps, ParsedArgs } from './types.js';

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function optionalBoolean(value: unknown): boolean {
  return value === true;
}

function parseTier(value: unknown): Tier | undefined {
  if (value === 'fast' || value === 'standard' || value === 'slow') {
    return value;
  }
  if (value === undefined) {
    return undefined;
  }
  throw new Error(`Invalid tier: ${String(value)}`);
}

function resolvePath(cwd: string, path: string): string {
  return isAbsolute(path) ? path : join(cwd, path);
}

function tierForTrigger(config: ResolvedConfig, trigger: string | undefined): Tier | undefined {
  if (!trigger) {
    return undefined;
  }
  for (const tier of ['fast', 'standard', 'slow'] as const) {
    if (config.tiers[tier].triggers.some((candidate) => candidate === trigger)) {
      return tier;
    }
  }
  return undefined;
}

function effectiveTier(
  config: ResolvedConfig,
  tier: Tier | undefined,
  trigger: string | undefined,
): Tier {
  const triggerTier = tierForTrigger(config, trigger);
  if (tier && triggerTier && tier !== triggerTier) {
    throw new Error(`Trigger "${trigger}" belongs to "${triggerTier}", not "${tier}"`);
  }
  return tier ?? triggerTier ?? 'standard';
}

export async function checkCommand(args: ParsedArgs, deps: CommandDeps): Promise<number> {
  const config = await loadConfig(deps.cwd, deps.fs);
  const tier = parseTier(args.tier);
  const trigger = optionalString(args.trigger);

  if (optionalBoolean(args.background)) {
    const jobsDir = resolvePath(deps.cwd, '.sentiness/jobs');
    const spawner = new JobSpawner(jobsDir, deps.fs, deps.clock);
    const cliPath = deps.cliPath ?? process.argv[1];
    if (!cliPath) {
      throw new Error('Unable to resolve Sentiness CLI entrypoint for background job');
    }
    const jobId = randomUUID();
    const resultPath = join(jobsDir, jobId, 'result.json');
    const originalArgs = process.argv
      .slice(2)
      .filter((arg) => arg !== '--background' && !arg.startsWith('--background='));
    const jobMeta = await spawner.spawn(
      process.execPath,
      [cliPath, ...originalArgs, `--output=${resultPath}`, `--job-id=${jobId}`],
      {
        cwd: deps.cwd,
        tier: effectiveTier(config, tier, trigger),
        jobId,
      },
    );

    deps.stdout.write(`${JSON.stringify({ jobId: jobMeta.jobId }, null, 2)}\n`);
    return 0;
  }

  const registry = await buildRegistry(config, deps);
  const baseRef = optionalString(args.base);
  const diffOnly = optionalBoolean(args.diff);
  const trend = optionalBoolean(args.trend);
  if (diffOnly && trend) {
    throw new Error('--diff and --trend cannot be used together');
  }
  const jobId = optionalString(args['job-id']) ?? optionalString(args.jobId);

  let exitCode = 0;
  let reportText = '';

  try {
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
      {
        ...(tier ? { tier } : {}),
        ...(trigger ? { trigger } : {}),
        diffOnly,
        trend,
        ...(baseRef ? { baseRef } : {}),
      },
    );

    const baselinePath = resolvePath(deps.cwd, config.baseline.path);
    const baseline = await BaselineManager.load(baselinePath, deps.fs);
    const application = applyBaselineToOutcome(outcome, baseline, {
      baselinePath,
      diffOnly,
    });
    const report = buildReport(application, config, {
      compact: optionalBoolean(args.compact) || config.reporting.compact,
      omitOk: config.reporting.omitOk,
    });
    reportText = `${JSON.stringify(report, null, 2)}\n`;
    exitCode = exitCodeFor(report);

    const outputPath = optionalString(args.output);
    if (outputPath) {
      const resolvedOutput = resolvePath(deps.cwd, outputPath);
      await deps.fs.mkdir(dirname(resolvedOutput), { recursive: true });
      await deps.fs.writeFile(resolvedOutput, reportText);
    }

    if (!jobId) {
      deps.stdout.write(reportText);
    }

    if (jobId) {
      const jobsDir = resolvePath(deps.cwd, '.sentiness/jobs');
      const jobMetaPath = join(jobsDir, jobId, 'meta.json');
      if (await deps.fs.exists(jobMetaPath)) {
        const meta = JSON.parse(await deps.fs.readFile(jobMetaPath));
        const finalMeta = {
          ...meta,
          status: 'completed',
          exitCode,
          completedAt: deps.clock.isoNow(),
        };
        await deps.fs.writeFile(jobMetaPath, `${JSON.stringify(finalMeta, null, 2)}\n`);
      }

      if (exitCode !== 0) {
        const pendingQueue = new PendingQueue(
          resolvePath(deps.cwd, config.pending.path),
          deps.fs,
          deps.clock,
          deps.logger,
        );
        const reportPath = optionalString(args.output) ?? join(jobsDir, jobId, 'result.json');
        await pendingQueue.enqueue({
          jobId,
          tier: outcome.context.tier,
          summary: `Background check finished with ${report.summary.totals.error} errors and ${report.summary.totals.warning} warnings.`,
          reportPath,
        });
      }
    }
  } catch (error) {
    if (jobId) {
      const jobsDir = resolvePath(deps.cwd, '.sentiness/jobs');
      const jobMetaPath = join(jobsDir, jobId, 'meta.json');
      if (await deps.fs.exists(jobMetaPath)) {
        const meta = JSON.parse(await deps.fs.readFile(jobMetaPath));
        const finalMeta = {
          ...meta,
          status: 'failed',
          exitCode: 3,
          completedAt: deps.clock.isoNow(),
        };
        await deps.fs.writeFile(jobMetaPath, `${JSON.stringify(finalMeta, null, 2)}\n`);
      }
    }
    throw error; // Re-throw to be caught by CLI wrap
  }

  return exitCode;
}

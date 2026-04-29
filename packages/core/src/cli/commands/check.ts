import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Tier } from '@sentiness/check-sdk';
import { BaselineManager } from '../../baseline/baseline.js';
import { applyBaselineToOutcome } from '../../baseline/diff-filter.js';
import { loadConfig } from '../../config/config.js';
import { JobSpawner } from '../../jobs/spawner.js';
import { PendingQueue } from '../../pending/pending.js';
import { CheckRegistry } from '../../registry/registry.js';
import { buildReport, exitCodeFor } from '../../reporter/reporter.js';
import { runChecks } from '../../runner/runner.js';
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

export async function checkCommand(args: ParsedArgs, deps: CommandDeps): Promise<number> {
  const config = await loadConfig(deps.cwd, deps.fs);
  const tier = parseTier(args.tier) ?? 'standard'; // Default to standard if spawning background

  if (optionalBoolean(args.background)) {
    const jobsDir = resolvePath(deps.cwd, '.sentiness/jobs');
    const spawner = new JobSpawner(jobsDir, deps.fs, deps.clock);
    const cliPath = fileURLToPath(import.meta.url).replace(
      /\/src\/cli\/commands\/check\.ts$/,
      '/dist/cli/index.js',
    );
    const originalArgs = process.argv.slice(2).filter((arg) => arg !== '--background');
    const jobMeta = await spawner.spawn(
      process.execPath,
      [
        cliPath,
        ...originalArgs,
        `--output=${join(jobsDir, '<jobId>', 'result.json')}`,
        '--job-id=<jobId>',
      ],
      {
        cwd: deps.cwd,
        tier,
      },
    );

    // Patch the <jobId> placeholders in args
    const actualArgs = jobMeta.args.map((arg) => arg.replace('<jobId>', jobMeta.jobId));
    // Re-write meta.json since we changed args
    const updatedMeta = { ...jobMeta, args: actualArgs };
    await deps.fs.writeFile(
      join(jobMeta.jobDir, 'meta.json'),
      `${JSON.stringify(updatedMeta, null, 2)}\n`,
    );

    deps.stdout.write(`${JSON.stringify({ jobId: jobMeta.jobId }, null, 2)}\n`);
    return 0;
  }

  const registry = await CheckRegistry.fromConfig(config, deps.cwd);
  const baseRef = optionalString(args.base);
  const diffOnly = optionalBoolean(args.diff);
  const trigger = optionalString(args.trigger);
  const jobId = optionalString(args['job-id']);

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
        );
        const reportPath = optionalString(args.output) ?? join(jobsDir, jobId, 'result.json');
        await pendingQueue.enqueue({
          jobId,
          tier,
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

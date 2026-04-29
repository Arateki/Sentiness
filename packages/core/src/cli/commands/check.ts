import { dirname, isAbsolute, join } from 'node:path';
import type { Tier } from '@sentiness/check-sdk';
import { BaselineManager } from '../../baseline/baseline.js';
import { applyBaselineToOutcome } from '../../baseline/diff-filter.js';
import { loadConfig } from '../../config/config.js';
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
  const registry = await CheckRegistry.fromConfig(config, deps.cwd);
  const tier = parseTier(args.tier);
  const baseRef = optionalString(args.base);
  const diffOnly = optionalBoolean(args.diff);
  const trigger = optionalString(args.trigger);
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
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  const outputPath = optionalString(args.output);
  if (outputPath) {
    const resolvedOutput = resolvePath(deps.cwd, outputPath);
    await deps.fs.mkdir(dirname(resolvedOutput), { recursive: true });
    await deps.fs.writeFile(resolvedOutput, serialized);
  }
  deps.stdout.write(serialized);
  return exitCodeFor(report);
}

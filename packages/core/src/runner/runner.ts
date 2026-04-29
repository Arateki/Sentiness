import { randomUUID } from 'node:crypto';
import { availableParallelism } from 'node:os';
import {
  asCheckId,
  asRuleId,
  type Category,
  type Check,
  type CheckId,
  type CheckResult,
  type Clock,
  type FileSystem,
  type GitProvider,
  type Logger,
  type ProcessRunner,
  type Tier,
} from '@sentiness/check-sdk';
import type { ResolvedConfig, Trigger } from '../config/config.js';
import type { CheckRegistry } from '../registry/registry.js';
import { runLimited } from './concurrency.js';

export type RunOptions = {
  readonly tier?: Tier;
  readonly trigger?: string;
  readonly diffOnly: boolean;
  readonly baseRef?: string;
  readonly maxConcurrency?: number;
  readonly signal?: AbortSignal;
};

export type RunInput = {
  readonly registry: CheckRegistry;
  readonly config: ResolvedConfig;
  readonly cwd: string;
  readonly fs: FileSystem;
  readonly process: ProcessRunner;
  readonly logger: Logger;
  readonly clock: Clock;
  readonly git: GitProvider;
};

export type RunMode = 'diff' | 'trend' | 'full';

export type RunContext = {
  readonly cwd: string;
  readonly tier: Tier;
  readonly trigger: string | null;
  readonly mode: RunMode;
  readonly baseRef: string | null;
  readonly headRef: string | null;
  readonly changedFiles: readonly string[];
};

export type RunOutcome = {
  readonly runId: string;
  readonly results: ReadonlyMap<CheckId, CheckResult>;
  readonly checkMetadata: ReadonlyMap<CheckId, { readonly category: Category }>;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly context: RunContext;
};

function triggerTier(config: ResolvedConfig, trigger: string): Tier | undefined {
  for (const tier of ['fast', 'standard', 'slow'] as const) {
    if (config.tiers[tier].triggers.includes(trigger as Trigger)) {
      return tier;
    }
  }
  return undefined;
}

function resolveTier(config: ResolvedConfig, options: RunOptions): Tier {
  const tierFromTrigger = options.trigger ? triggerTier(config, options.trigger) : undefined;
  if (options.tier && tierFromTrigger && options.tier !== tierFromTrigger) {
    throw new Error(
      `Trigger "${options.trigger}" belongs to "${tierFromTrigger}", not "${options.tier}"`,
    );
  }
  if (options.tier) {
    return options.tier;
  }
  return tierFromTrigger ?? 'standard';
}

function timeoutSignal(parent: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref();

  if (parent) {
    if (parent.aborted) {
      controller.abort();
    } else {
      parent.addEventListener('abort', () => controller.abort(), { once: true });
    }
  }

  return controller.signal;
}

function errorResult(message: string, durationMs: number): CheckResult {
  return {
    status: 'error',
    findings: [],
    durationMs,
    errorMessage: message,
  };
}

function skippedResult(reason: string, durationMs: number): CheckResult {
  return {
    status: 'skipped',
    findings: [],
    durationMs,
    skipReason: reason,
  };
}

async function runOneCheck(
  check: Check,
  input: RunInput,
  context: RunContext,
  options: RunOptions,
): Promise<CheckResult> {
  const started = input.clock.now();
  const signal = timeoutSignal(options.signal, input.config.tiers[context.tier].timeoutMs);
  const checkConfig = input.config.checks[check.id] ?? { enabled: true };
  const checkContext = {
    cwd: input.cwd,
    tier: context.tier,
    trigger: context.trigger,
    baseRef: context.baseRef,
    changedFiles: context.changedFiles,
    diffOnly: options.diffOnly,
    signal,
    logger: input.logger,
    fs: input.fs,
    process: input.process,
    checkConfig,
  };

  try {
    const detect = await check.detect(checkContext);
    if (!detect.available) {
      return skippedResult(detect.reason ?? 'check unavailable', input.clock.now() - started);
    }
    const result = await check.run(checkContext);
    return { ...result, durationMs: input.clock.now() - started };
  } catch (error) {
    return errorResult(
      error instanceof Error ? error.message : 'unknown check error',
      input.clock.now() - started,
    );
  }
}

function syntheticLoadFailureResults(input: RunInput): ReadonlyMap<CheckId, CheckResult> {
  const results = new Map<CheckId, CheckResult>();
  for (const failure of input.registry.loadFailures()) {
    results.set(failure.requestedId, {
      status: 'error',
      durationMs: 0,
      errorMessage: failure.message,
      findings: [
        {
          id: `registry:${failure.requestedId}`,
          checkId: failure.requestedId,
          ruleId: asRuleId('check-load-error'),
          severity: 'error',
          message: `Failed to load ${failure.moduleName}: ${failure.message}`,
          location: { file: 'sentiness.config.json' },
          fingerprint: '0'.repeat(64),
        },
      ],
    });
  }
  return results;
}

export async function runChecks(input: RunInput, options: RunOptions): Promise<RunOutcome> {
  const startedAt = input.clock.isoNow();
  const started = input.clock.now();
  const tier = resolveTier(input.config, options);
  const baseRef = options.baseRef ?? 'HEAD';
  const changedFiles = options.diffOnly ? await input.git.changedFiles(input.cwd, baseRef) : [];
  const context: RunContext = {
    cwd: input.cwd,
    tier,
    trigger: options.trigger ?? null,
    mode: options.diffOnly ? 'diff' : 'full',
    baseRef: options.diffOnly ? baseRef : null,
    headRef: 'HEAD',
    changedFiles,
  };
  const results = new Map<CheckId, CheckResult>(syntheticLoadFailureResults(input));
  const checkMetadata = new Map<CheckId, { readonly category: Category }>();
  for (const failure of input.registry.loadFailures()) {
    checkMetadata.set(failure.requestedId, { category: 'lint' });
  }
  const checks = input.registry.filterByTier(tier);
  const concurrency = options.maxConcurrency ?? Math.max(1, availableParallelism() - 1);

  await runLimited(checks, concurrency, async (check) => {
    checkMetadata.set(check.id, { category: check.category });
    results.set(check.id, await runOneCheck(check, input, context, options));
  });

  const completedAt = input.clock.isoNow();
  return {
    runId: randomUUID(),
    results,
    checkMetadata,
    startedAt,
    completedAt,
    durationMs: input.clock.now() - started,
    context,
  };
}

export const REGISTRY_CHECK_ID = asCheckId('registry');

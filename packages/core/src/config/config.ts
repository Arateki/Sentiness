import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Category, FileSystem, Tier } from '@sentiness/check-sdk';
import { z } from 'zod';

const TriggerSchema = z.enum([
  'post-edit',
  'pre-done',
  'pre-commit',
  'pre-push',
  'pre-pr',
  'manual',
]);
const TierSchema = z.enum(['fast', 'standard', 'slow']);
const AgentSchema = z.enum(['claude-code', 'codex', 'gemini']);

const TierConfigSchema = z.object({
  triggers: z.array(TriggerSchema),
  timeoutMs: z.number().int().positive(),
});

const CheckConfigSchema = z
  .object({
    enabled: z.boolean(),
    tier: TierSchema.optional(),
    thresholds: z.record(z.string(), z.union([z.number(), z.string()])).optional(),
  })
  .catchall(z.unknown());

const SentinessConfigSchema = z.object({
  schemaVersion: z.literal('1.0'),
  tiers: z
    .object({
      fast: TierConfigSchema.partial().optional(),
      standard: TierConfigSchema.partial().optional(),
      slow: TierConfigSchema.partial().optional(),
    })
    .optional(),
  checks: z.record(z.string(), CheckConfigSchema).optional(),
  baseline: z.object({ path: z.string().min(1) }).optional(),
  pending: z.object({ path: z.string().min(1) }).optional(),
  reporting: z
    .object({
      compact: z.boolean().optional(),
      omitOk: z.boolean().optional(),
      warningsAreErrors: z.boolean().optional(),
    })
    .optional(),
  agents: z.array(AgentSchema).optional(),
});

const JsConfigModuleSchema = z.object({ default: z.unknown() });

export type Trigger = z.infer<typeof TriggerSchema>;

export type CheckConfig = {
  readonly enabled: boolean;
  readonly tier?: Tier;
  readonly thresholds?: Readonly<Record<string, number | string>>;
  readonly [key: string]: unknown;
};

export type SentinessConfig = {
  readonly schemaVersion: '1.0';
  readonly tiers?: {
    readonly fast?: Partial<TierSettings>;
    readonly standard?: Partial<TierSettings>;
    readonly slow?: Partial<TierSettings>;
  };
  readonly checks?: Readonly<Record<string, CheckConfig>>;
  readonly baseline?: { readonly path: string };
  readonly pending?: { readonly path: string };
  readonly reporting?: {
    readonly compact?: boolean;
    readonly omitOk?: boolean;
    readonly warningsAreErrors?: boolean;
  };
  readonly agents?: readonly ('claude-code' | 'codex' | 'gemini')[];
};

export type TierSettings = {
  readonly triggers: readonly Trigger[];
  readonly timeoutMs: number;
};

export type ResolvedConfig = {
  readonly schemaVersion: '1.0';
  readonly tiers: Readonly<Record<Tier, TierSettings>>;
  readonly checks: Readonly<Record<string, CheckConfig>>;
  readonly baseline: { readonly path: string };
  readonly pending: { readonly path: string };
  readonly reporting: {
    readonly compact: boolean;
    readonly omitOk: boolean;
    readonly warningsAreErrors: boolean;
  };
  readonly agents: readonly ('claude-code' | 'codex' | 'gemini')[];
};

export const DEFAULT_CONFIG: ResolvedConfig = {
  schemaVersion: '1.0',
  tiers: {
    fast: { triggers: ['post-edit', 'pre-commit'], timeoutMs: 30_000 },
    standard: { triggers: ['pre-done'], timeoutMs: 120_000 },
    slow: { triggers: ['pre-push', 'pre-pr', 'manual'], timeoutMs: 600_000 },
  },
  checks: {},
  baseline: { path: '.sentiness/baseline.json' },
  pending: { path: '.sentiness/pending-feedback.json' },
  reporting: { compact: false, omitOk: false, warningsAreErrors: false },
  agents: [],
};

export class ConfigParseError extends Error {
  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options);
    this.name = 'ConfigParseError';
  }
}

export class ConfigNotFoundError extends Error {
  constructor(cwd: string) {
    super(`No sentiness.config.js or sentiness.config.json found in ${cwd}`);
    this.name = 'ConfigNotFoundError';
  }
}

function normalizeZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
    .join('; ');
}

function validateNoDuplicateTriggers(config: ResolvedConfig): void {
  const seen = new Map<Trigger, Tier>();
  for (const tier of ['fast', 'standard', 'slow'] as const) {
    for (const trigger of config.tiers[tier].triggers) {
      const previous = seen.get(trigger);
      if (previous) {
        throw new ConfigParseError(
          `Trigger "${trigger}" appears in both "${previous}" and "${tier}" tiers`,
        );
      }
      seen.set(trigger, tier);
    }
  }
}

function mergeTier(
  defaultTier: TierSettings,
  userTier: Partial<TierSettings> | undefined,
): TierSettings {
  return {
    triggers: userTier?.triggers ?? defaultTier.triggers,
    timeoutMs: userTier?.timeoutMs ?? defaultTier.timeoutMs,
  };
}

export function validateConfig(input: unknown): SentinessConfig {
  const parsed = SentinessConfigSchema.safeParse(input);
  if (!parsed.success) {
    throw new ConfigParseError(normalizeZodError(parsed.error), { cause: parsed.error });
  }
  return parsed.data as SentinessConfig;
}

export function resolveConfig(config: SentinessConfig): ResolvedConfig {
  const resolved: ResolvedConfig = {
    schemaVersion: '1.0',
    tiers: {
      fast: mergeTier(DEFAULT_CONFIG.tiers.fast, config.tiers?.fast),
      standard: mergeTier(DEFAULT_CONFIG.tiers.standard, config.tiers?.standard),
      slow: mergeTier(DEFAULT_CONFIG.tiers.slow, config.tiers?.slow),
    },
    checks: { ...DEFAULT_CONFIG.checks, ...(config.checks ?? {}) },
    baseline: { path: config.baseline?.path ?? DEFAULT_CONFIG.baseline.path },
    pending: { path: config.pending?.path ?? DEFAULT_CONFIG.pending.path },
    reporting: {
      compact: config.reporting?.compact ?? DEFAULT_CONFIG.reporting.compact,
      omitOk: config.reporting?.omitOk ?? DEFAULT_CONFIG.reporting.omitOk,
      warningsAreErrors:
        config.reporting?.warningsAreErrors ?? DEFAULT_CONFIG.reporting.warningsAreErrors,
    },
    agents: config.agents ?? DEFAULT_CONFIG.agents,
  };
  validateNoDuplicateTriggers(resolved);
  return resolved;
}

async function loadJsConfig(path: string, fs: FileSystem): Promise<unknown> {
  const realPath = await fs.realpath(path);
  const moduleValue: unknown = await import(`${pathToFileURL(realPath).href}?t=${Date.now()}`);
  return JsConfigModuleSchema.parse(moduleValue).default;
}

export async function loadConfig(cwd: string, fs: FileSystem): Promise<ResolvedConfig> {
  const jsPath = join(cwd, 'sentiness.config.js');
  const jsonPath = join(cwd, 'sentiness.config.json');

  if (await fs.exists(jsPath)) {
    return resolveConfig(validateConfig(await loadJsConfig(jsPath, fs)));
  }

  if (await fs.exists(jsonPath)) {
    try {
      return resolveConfig(validateConfig(JSON.parse(await fs.readFile(jsonPath))));
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new ConfigParseError(`Invalid JSON in ${jsonPath}: ${error.message}`, {
          cause: error,
        });
      }
      throw error;
    }
  }

  throw new ConfigNotFoundError(cwd);
}

export function categoryFromString(value: string): Category | undefined {
  const categories: readonly Category[] = [
    'lint',
    'architecture',
    'test-quality',
    'coverage',
    'security',
    'duplication',
    'complexity',
    'platform',
  ];
  return categories.includes(value as Category) ? (value as Category) : undefined;
}

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
const AgentSchema = z.enum(['claude-code', 'claude-code-skill', 'codex', 'codex-skill', 'gemini']);

const TierConfigSchema = z.object({
  triggers: z.array(TriggerSchema),
  timeoutMs: z.number().int().positive(),
});

const CatalogCheckEntrySchema = z
  .object({
    version: z.string().min(1).optional(),
    path: z.string().min(1).optional(),
    tier: TierSchema.optional(),
    toolVersion: z.string().min(1).optional(),
    thresholds: z.record(z.string(), z.union([z.number(), z.string()])).optional(),
  })
  .catchall(z.unknown());

const ZoneCheckOverrideSchema = z
  .object({
    id: z.string().min(1),
    tier: TierSchema.optional(),
    thresholds: z.record(z.string(), z.union([z.number(), z.string()])).optional(),
  })
  .catchall(z.unknown());

const ZoneEntrySchema = z.object({
  path: z.string().min(1),
  checks: z.array(z.union([z.string().min(1), ZoneCheckOverrideSchema])),
});

const SentinessConfigSchema = z.object({
  schemaVersion: z.literal('2.0'),
  engine: z.string().min(1),
  checks: z.record(z.string(), CatalogCheckEntrySchema),
  zones: z.array(ZoneEntrySchema).optional(),
  tiers: z
    .object({
      fast: TierConfigSchema.partial().optional(),
      standard: TierConfigSchema.partial().optional(),
      slow: TierConfigSchema.partial().optional(),
    })
    .optional(),
  reporting: z
    .object({
      compact: z.boolean().optional(),
      omitOk: z.boolean().optional(),
      warningsAreErrors: z.boolean().optional(),
    })
    .optional(),
  baseline: z.object({ path: z.string().min(1) }).optional(),
  pending: z.object({ path: z.string().min(1) }).optional(),
  agents: z.array(AgentSchema).optional(),
});

const JsConfigModuleSchema = z.object({ default: z.unknown() });

export type Trigger = z.infer<typeof TriggerSchema>;
export type CatalogCheckEntry = z.infer<typeof CatalogCheckEntrySchema>;
export type ZoneCheckOverride = z.infer<typeof ZoneCheckOverrideSchema>;
export type ZoneEntry = z.infer<typeof ZoneEntrySchema>;
export type SentinessConfigV2 = z.infer<typeof SentinessConfigSchema>;

export type TierSettings = { readonly triggers: readonly Trigger[]; readonly timeoutMs: number };
export type Agent = z.infer<typeof AgentSchema>;

export type ResolvedConfig = {
  readonly schemaVersion: '2.0';
  readonly engine: string;
  readonly checks: Readonly<Record<string, CatalogCheckEntry>>;
  readonly zones: readonly ZoneEntry[];
  readonly tiers: Readonly<Record<Tier, TierSettings>>;
  readonly reporting: {
    readonly compact: boolean;
    readonly omitOk: boolean;
    readonly warningsAreErrors: boolean;
  };
  readonly baseline: { readonly path: string };
  readonly pending: { readonly path: string };
  readonly agents: readonly Agent[];
};

export const DEFAULT_TIERS: Readonly<Record<Tier, TierSettings>> = {
  fast: { triggers: ['post-edit', 'pre-commit'], timeoutMs: 30_000 },
  standard: { triggers: ['pre-done'], timeoutMs: 120_000 },
  slow: { triggers: ['pre-push', 'pre-pr', 'manual'], timeoutMs: 600_000 },
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

function zoneCheckId(entry: string | ZoneCheckOverride): string {
  return typeof entry === 'string' ? entry : entry.id;
}

function validateCrossFields(config: SentinessConfigV2): void {
  for (const [id, entry] of Object.entries(config.checks)) {
    const hasVersion = entry.version !== undefined;
    const hasPath = entry.path !== undefined;
    if (hasVersion === hasPath) {
      throw new ConfigParseError(`checks.${id}: exactly one of "version" or "path" is required`);
    }
  }
  const seenZonePaths = new Set<string>();
  for (const zone of config.zones ?? []) {
    if (seenZonePaths.has(zone.path)) {
      throw new ConfigParseError(`Duplicate zone path "${zone.path}"`);
    }
    seenZonePaths.add(zone.path);
    for (const entry of zone.checks) {
      const id = zoneCheckId(entry);
      if (!(id in config.checks)) {
        throw new ConfigParseError(`Zone "${zone.path}" references unknown check id "${id}"`);
      }
    }
  }
}

export function validateConfig(input: unknown): SentinessConfigV2 {
  if (
    typeof input === 'object' &&
    input !== null &&
    (input as { schemaVersion?: unknown }).schemaVersion === '1.0'
  ) {
    throw new ConfigParseError(
      'schemaVersion "1.0" is no longer supported — run `sentiness init` to migrate to v2',
    );
  }
  const parsed = SentinessConfigSchema.safeParse(input);
  if (!parsed.success) {
    throw new ConfigParseError(normalizeZodError(parsed.error), { cause: parsed.error });
  }
  validateCrossFields(parsed.data);
  return parsed.data;
}

type PartialTierOverride = {
  readonly triggers?: readonly Trigger[] | undefined;
  readonly timeoutMs?: number | undefined;
};

function mergeTier(base: TierSettings, override: PartialTierOverride | undefined): TierSettings {
  return {
    triggers: override?.triggers ?? base.triggers,
    timeoutMs: override?.timeoutMs ?? base.timeoutMs,
  };
}

function validateNoDuplicateTriggers(tiers: Readonly<Record<Tier, TierSettings>>): void {
  const seen = new Map<Trigger, Tier>();
  for (const tier of ['fast', 'standard', 'slow'] as const) {
    for (const trigger of tiers[tier].triggers) {
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

export function resolveConfig(config: SentinessConfigV2): ResolvedConfig {
  const tiers: Record<Tier, TierSettings> = {
    fast: mergeTier(DEFAULT_TIERS.fast, config.tiers?.fast),
    standard: mergeTier(DEFAULT_TIERS.standard, config.tiers?.standard),
    slow: mergeTier(DEFAULT_TIERS.slow, config.tiers?.slow),
  };
  validateNoDuplicateTriggers(tiers);
  const zones: readonly ZoneEntry[] = config.zones ?? [
    { path: '.', checks: Object.keys(config.checks) },
  ];
  return {
    schemaVersion: '2.0',
    engine: config.engine,
    checks: config.checks,
    zones,
    tiers,
    reporting: {
      compact: config.reporting?.compact ?? false,
      omitOk: config.reporting?.omitOk ?? false,
      warningsAreErrors: config.reporting?.warningsAreErrors ?? false,
    },
    baseline: { path: config.baseline?.path ?? '.sentiness/baseline.json' },
    pending: { path: config.pending?.path ?? '.sentiness/pending-feedback.json' },
    agents: config.agents ?? [],
  };
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

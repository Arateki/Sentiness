# Sentiness v2 — Phase V1 (Global Spine) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Sentiness run from a global launcher against a project with **zero `node_modules`**, using the existing JS checks fetched into a global cache, with determinism guaranteed by a committed `sentiness.lock`.

**Architecture:** A new thin launcher package `@sentiness/cli` (the only thing a user installs globally) reads the project's `sentiness.config.json` (schema v2) + `sentiness.lock`, npm-fetches the version-pinned engine `@sentiness/core` into `~/.sentiness/cache/`, and spawns it with `--cache-root`. The engine owns cache paths, the lock manager, the artifact store, the `install` command, and a `CheckRegistry` that resolves checks from cache slots (or from local `path`-linked packages for dogfooding) instead of the project's `node_modules`. Tool resolution is `override → host → fetch(npm)`: npm tools ship as a dependency of each check (materialized into the check's slot); non-npm tools (osv-scanner, semgrep) stay detect-only on the host.

**Tech Stack:** TypeScript 5.4+ (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), pnpm workspace, Vitest, Zod 4, `cac`, Node built-ins (`node:crypto`, `node:child_process` via the injected `ProcessRunner`). No new third-party runtime deps.

**Spec:** `docs/superpowers/specs/2026-06-15-sentiness-v2-global-multi-language-design.md` (this plan implements **Phase V1 only**: spec tasks TV1.1–TV1.7. V2/V3/V4 get their own plans.)

**Conventions (apply to every commit):** Honor `CLAUDE.md §3` (no `any`, no unsafe `as`, no `console.log`, no swallowed errors). Commit messages use Conventional Commits and end with the trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Run `pnpm lint` and `pnpm --filter @sentiness/core typecheck` before each commit.

**Test command shorthand:** From repo root, a single core test file is run with
`pnpm --filter @sentiness/core exec vitest run --config ../../vitest.config.base.ts <relative-path>`.
The full package suite is `pnpm --filter @sentiness/core test`.

---

## File Structure

**New modules in `@sentiness/core` (the engine):**

| Path | Responsibility |
|---|---|
| `packages/core/src/config/config.ts` | **Rewritten** to schema v2 (catalog + zones + engine pin). |
| `packages/core/src/cache/paths.ts` | Cache-slot path computation. Takes the cache root explicitly. |
| `packages/core/src/cache/artifact-store.ts` | Fetch (`npm install`) a pinned artifact into a slot; marker + integrity. |
| `packages/core/src/lock/schema.ts` | Zod schema + types for `sentiness.lock`. |
| `packages/core/src/lock/lock.ts` | `LockManager` load/save/`satisfies`. |
| `packages/core/src/registry/registry.ts` | **Rewritten** `CheckRegistry.fromResolved` (cache + path-linked). |
| `packages/core/src/cli/commands/install.ts` | `sentiness install [--frozen]`. |
| `packages/core/src/cli/index.ts` | **Modified** to accept `--cache-root` and thread it into `CommandDeps`. |
| `packages/core/src/cli/commands/types.ts` | **Modified**: add `cacheRoot` to `CommandDeps`. |

**New package `@sentiness/cli` (the launcher):**

| Path | Responsibility |
|---|---|
| `packages/cli/package.json` | The `sentiness` bin. No dependency on `@sentiness/core`. |
| `packages/cli/src/index.ts` | Process entrypoint: builds deps, calls `run`. |
| `packages/cli/src/bootstrap.ts` | Self-contained: resolve cache root, peek config/lock, npm-fetch engine, spawn. |

**Modified check packages (TV1.7):** `packages/checks/{biome,eslint,knip,jscpd}/package.json` add their tool as an exact dependency. `packages/core/src/process/process-runner.ts` gains slot-bin support. `packages/check-sdk/src/types.ts` gains `CheckContext.binPaths`.

**Test-double extension:** `packages/_test-utils/src/in-memory-fs.ts` — `rename` must support directories (needed by the artifact store).

---

## Task 1: Config schema v2

Implements spec **TV1.1**. Rewrites the config module from the v1 flat shape to the v2 catalog + zones shape with an `engine` pin. No backward compatibility.

**Files:**
- Modify (rewrite): `packages/core/src/config/config.ts`
- Modify (rewrite): `packages/core/src/config/config.test.ts`

- [ ] **Step 1: Write the failing tests for v2 validation and resolution**

Replace the contents of `packages/core/src/config/config.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import { InMemoryFileSystem } from '@sentiness/_test-utils';
import {
  ConfigNotFoundError,
  ConfigParseError,
  loadConfig,
  resolveConfig,
  validateConfig,
} from './config.js';

const minimal = {
  schemaVersion: '2.0',
  engine: '2.0.0',
  checks: { biome: { version: '2.0.0' } },
};

describe('validateConfig', () => {
  it('accepts a minimal v2 config', () => {
    expect(() => validateConfig(minimal)).not.toThrow();
  });

  it('rejects a v1 schemaVersion with a migration hint', () => {
    expect(() => validateConfig({ ...minimal, schemaVersion: '1.0' })).toThrowError(
      /sentiness init/,
    );
  });

  it('rejects a catalog entry with both version and path', () => {
    expect(() =>
      validateConfig({ ...minimal, checks: { biome: { version: '2.0.0', path: 'x' } } }),
    ).toThrowError(/exactly one of/);
  });

  it('rejects a catalog entry with neither version nor path', () => {
    expect(() => validateConfig({ ...minimal, checks: { biome: {} } })).toThrowError(
      /exactly one of/,
    );
  });

  it('rejects a zone referencing an unknown check id', () => {
    expect(() =>
      validateConfig({ ...minimal, zones: [{ path: 'apps/web', checks: ['ghost'] }] }),
    ).toThrowError(/apps\/web.*ghost/);
  });

  it('rejects duplicate zone paths', () => {
    expect(() =>
      validateConfig({
        ...minimal,
        zones: [
          { path: '.', checks: ['biome'] },
          { path: '.', checks: ['biome'] },
        ],
      }),
    ).toThrowError(/duplicate zone path/i);
  });
});

describe('resolveConfig', () => {
  it('normalizes an absent zones array to a single root zone with all catalog ids', () => {
    const resolved = resolveConfig(validateConfig({ ...minimal, checks: { biome: { version: '1' }, knip: { version: '1' } } }));
    expect(resolved.zones).toEqual([{ path: '.', checks: ['biome', 'knip'] }]);
  });

  it('keeps explicit zones', () => {
    const resolved = resolveConfig(
      validateConfig({ ...minimal, zones: [{ path: 'apps/web', checks: ['biome'] }] }),
    );
    expect(resolved.zones).toEqual([{ path: 'apps/web', checks: ['biome'] }]);
  });

  it('applies tier and reporting defaults', () => {
    const resolved = resolveConfig(validateConfig(minimal));
    expect(resolved.tiers.fast.timeoutMs).toBe(30_000);
    expect(resolved.reporting.compact).toBe(false);
    expect(resolved.baseline.path).toBe('.sentiness/baseline.json');
  });

  it('rejects a trigger appearing in two tiers', () => {
    expect(() =>
      resolveConfig(
        validateConfig({
          ...minimal,
          tiers: { fast: { triggers: ['pre-done'], timeoutMs: 1 }, standard: { triggers: ['pre-done'], timeoutMs: 1 } },
        }),
      ),
    ).toThrowError(/appears in both/);
  });
});

describe('loadConfig', () => {
  it('throws ConfigNotFoundError when no config file exists', async () => {
    const fs = new InMemoryFileSystem();
    await expect(loadConfig('/project', fs)).rejects.toBeInstanceOf(ConfigNotFoundError);
  });

  it('loads and resolves a JSON config', async () => {
    const fs = new InMemoryFileSystem({ '/project/sentiness.config.json': JSON.stringify(minimal) });
    const resolved = await loadConfig('/project', fs);
    expect(resolved.engine).toBe('2.0.0');
    expect(resolved.zones).toEqual([{ path: '.', checks: ['biome'] }]);
  });

  it('wraps invalid JSON in ConfigParseError', async () => {
    const fs = new InMemoryFileSystem({ '/project/sentiness.config.json': '{ not json' });
    await expect(loadConfig('/project', fs)).rejects.toBeInstanceOf(ConfigParseError);
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `pnpm --filter @sentiness/core exec vitest run --config ../../vitest.config.base.ts src/config/config.test.ts`
Expected: FAIL (the current `config.ts` exports the v1 shape; `engine`/`zones` are undefined, type/assertion errors).

- [ ] **Step 3: Rewrite `config.ts` to schema v2**

Replace the contents of `packages/core/src/config/config.ts` with:

```ts
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Category, FileSystem, Tier } from '@sentiness/check-sdk';
import { z } from 'zod';

const TriggerSchema = z.enum(['post-edit', 'pre-done', 'pre-commit', 'pre-push', 'pre-pr', 'manual']);
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
  readonly reporting: { readonly compact: boolean; readonly omitOk: boolean; readonly warningsAreErrors: boolean };
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
  return error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`).join('; ');
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
  if (typeof input === 'object' && input !== null && (input as { schemaVersion?: unknown }).schemaVersion === '1.0') {
    throw new ConfigParseError('schemaVersion "1.0" is no longer supported — run `sentiness init` to migrate to v2');
  }
  const parsed = SentinessConfigSchema.safeParse(input);
  if (!parsed.success) {
    throw new ConfigParseError(normalizeZodError(parsed.error), { cause: parsed.error });
  }
  validateCrossFields(parsed.data);
  return parsed.data;
}

function mergeTier(base: TierSettings, override: Partial<TierSettings> | undefined): TierSettings {
  return { triggers: override?.triggers ?? base.triggers, timeoutMs: override?.timeoutMs ?? base.timeoutMs };
}

function validateNoDuplicateTriggers(tiers: Readonly<Record<Tier, TierSettings>>): void {
  const seen = new Map<Trigger, Tier>();
  for (const tier of ['fast', 'standard', 'slow'] as const) {
    for (const trigger of tiers[tier].triggers) {
      const previous = seen.get(trigger);
      if (previous) {
        throw new ConfigParseError(`Trigger "${trigger}" appears in both "${previous}" and "${tier}" tiers`);
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
  const zones: readonly ZoneEntry[] =
    config.zones ?? [{ path: '.', checks: Object.keys(config.checks) }];
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
        throw new ConfigParseError(`Invalid JSON in ${jsonPath}: ${error.message}`, { cause: error });
      }
      throw error;
    }
  }
  throw new ConfigNotFoundError(cwd);
}

export function categoryFromString(value: string): Category | undefined {
  const categories: readonly Category[] = ['lint', 'architecture', 'test-quality', 'coverage', 'security', 'duplication', 'complexity', 'platform'];
  return categories.includes(value as Category) ? (value as Category) : undefined;
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `pnpm --filter @sentiness/core exec vitest run --config ../../vitest.config.base.ts src/config/config.test.ts`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Fix compile fallout from the rewrite, then typecheck**

The v1 `config.ts` exported `SentinessConfig`, `CheckConfig`, `DEFAULT_CONFIG`. Other modules import these. Run `pnpm --filter @sentiness/core typecheck` and fix each error by updating the importing site to the v2 types (`ResolvedConfig.checks` is now `Record<string, CatalogCheckEntry>`; there is no `DEFAULT_CONFIG`, use `DEFAULT_TIERS` where a tier default was needed). Do **not** re-add v1 types. If a consumer (e.g. `registry.ts`, `runner.ts`, a command) is rewritten in a later task, leave a compile error only if that task is next; otherwise patch minimally to keep the build green.

Run: `pnpm --filter @sentiness/core typecheck`
Expected: PASS once consumers are patched. (Expect to touch `registry.ts` — but it is fully rewritten in Task 4; a minimal stub is acceptable here, or sequence Task 4 immediately after.)

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/config/config.ts packages/core/src/config/config.test.ts
git commit -m "feat(core)!: rewrite config to schema v2 (catalog + zones + engine pin)"
```

---

## Task 2: Cache paths + artifact store

Implements spec **TV1.3**. New modules that compute cache-slot paths and materialize a pinned npm artifact into a slot. Also extends the in-memory test FS with directory rename (the artifact store renames a temp dir into the slot).

**Files:**
- Create: `packages/core/src/cache/paths.ts`
- Create: `packages/core/src/cache/paths.test.ts`
- Create: `packages/core/src/cache/artifact-store.ts`
- Create: `packages/core/src/cache/artifact-store.test.ts`
- Modify: `packages/_test-utils/src/in-memory-fs.ts` (directory-aware `rename`)

- [ ] **Step 1: Extend `InMemoryFileSystem.rename` to support directories**

The artifact store does `fs.rename(tmpDir, slot)` on a directory. The current double only renames a single file. In `packages/_test-utils/src/in-memory-fs.ts`, replace the `rename` method with:

```ts
  async rename(from: string, to: string): Promise<void> {
    const normalizedFrom = normalizePath(from);
    const file = this.files.get(normalizedFrom);
    if (file) {
      this.files.delete(normalizedFrom);
      this.writeSync(to, file.content);
      return;
    }
    if (this.directories.has(normalizedFrom)) {
      const normalizedTo = normalizePath(to);
      const prefix = `${normalizedFrom}/`;
      for (const [path, value] of [...this.files.entries()]) {
        if (path.startsWith(prefix)) {
          this.files.delete(path);
          this.writeSync(join(normalizedTo, path.slice(prefix.length)), value.content);
        }
      }
      for (const dir of [...this.directories]) {
        if (dir === normalizedFrom || dir.startsWith(prefix)) {
          this.directories.delete(dir);
        }
      }
      this.ensureDir(normalizedTo);
      return;
    }
    throw new Error(`Path not found: ${from}`);
  }
```

Run: `pnpm --filter @sentiness/_test-utils test`
Expected: PASS (existing in-memory-fs tests still green; directory rename is additive).

- [ ] **Step 2: Write the failing test for cache paths**

Create `packages/core/src/cache/paths.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createCachePaths } from './paths.js';

describe('createCachePaths', () => {
  const paths = createCachePaths('/home/u/.sentiness');

  it('places engine slots under cache/engine/<version>', () => {
    expect(paths.slotPath({ kind: 'engine', id: 'core', version: '2.0.0' })).toBe(
      '/home/u/.sentiness/cache/engine/2.0.0',
    );
  });

  it('places check slots under cache/checks/<id>/<version>', () => {
    expect(paths.slotPath({ kind: 'check', id: 'biome', version: '1.3.0' })).toBe(
      '/home/u/.sentiness/cache/checks/biome/1.3.0',
    );
  });

  it('exposes a tmp dir under the cache root', () => {
    expect(paths.tmpDir()).toBe('/home/u/.sentiness/cache/tmp');
  });
});
```

- [ ] **Step 3: Run it and verify it fails**

Run: `pnpm --filter @sentiness/core exec vitest run --config ../../vitest.config.base.ts src/cache/paths.test.ts`
Expected: FAIL ("Cannot find module './paths.js'").

- [ ] **Step 4: Implement `paths.ts`**

Create `packages/core/src/cache/paths.ts`:

```ts
import { join } from 'node:path';

export type ArtifactKind = 'engine' | 'check';

export interface ArtifactRef {
  readonly kind: ArtifactKind;
  readonly id: string; // 'core' for the engine; the check id otherwise
  readonly version: string; // exact
  readonly integrity?: string;
}

export interface CachePaths {
  readonly root: string;
  slotPath(ref: ArtifactRef): string;
  tmpDir(): string;
}

export function createCachePaths(cacheRoot: string): CachePaths {
  const cache = join(cacheRoot, 'cache');
  return {
    root: cacheRoot,
    slotPath(ref) {
      return ref.kind === 'engine'
        ? join(cache, 'engine', ref.version)
        : join(cache, 'checks', ref.id, ref.version);
    },
    tmpDir() {
      return join(cache, 'tmp');
    },
  };
}
```

- [ ] **Step 5: Run it and verify it passes**

Run: `pnpm --filter @sentiness/core exec vitest run --config ../../vitest.config.base.ts src/cache/paths.test.ts`
Expected: PASS.

- [ ] **Step 6: Write the failing test for the artifact store**

Create `packages/core/src/cache/artifact-store.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { FakeProcessRunner, InMemoryFileSystem, SilentLogger } from '@sentiness/_test-utils';
import { ArtifactFetchError, createArtifactStore } from './artifact-store.js';
import { createCachePaths } from './paths.js';

function makeStore(fs: InMemoryFileSystem, process: FakeProcessRunner) {
  return createArtifactStore({
    paths: createCachePaths('/home/u/.sentiness'),
    fs,
    process,
    logger: new SilentLogger(),
    randomId: () => 'TMPID',
  });
}

const ref = { kind: 'check', id: 'biome', version: '1.3.0' } as const;

describe('artifact store', () => {
  it('isMaterialized is false before, true after a marker is written', async () => {
    const fs = new InMemoryFileSystem();
    const store = makeStore(fs, new FakeProcessRunner());
    expect(await store.isMaterialized(ref)).toBe(false);
    await fs.writeFile('/home/u/.sentiness/cache/checks/biome/1.3.0/.sentiness-materialized', 'x');
    expect(await store.isMaterialized(ref)).toBe(true);
  });

  it('materialize runs npm install with the exact spec and renames into the slot', async () => {
    const fs = new InMemoryFileSystem();
    const process = new FakeProcessRunner();
    process.enqueue({ stdout: '', stderr: '', exitCode: 0 });
    const store = makeStore(fs, process);

    const result = await store.materialize(ref, { packageName: '@sentiness/check-biome' });

    expect(process.calls[0]?.command).toBe('npm');
    expect(process.calls[0]?.args).toEqual([
      'install', '--prefix', '/home/u/.sentiness/cache/tmp/TMPID', '--no-save',
      '--no-audit', '--no-fund', '@sentiness/check-biome@1.3.0',
    ]);
    expect(result.path).toBe('/home/u/.sentiness/cache/checks/biome/1.3.0');
    expect(await store.isMaterialized(ref)).toBe(true);
  });

  it('appends extraInstalls (toolVersion override) to the npm spec', async () => {
    const fs = new InMemoryFileSystem();
    const process = new FakeProcessRunner();
    process.enqueue({ stdout: '', stderr: '', exitCode: 0 });
    const store = makeStore(fs, process);
    await store.materialize(ref, { packageName: '@sentiness/check-biome', extraInstalls: ['@biomejs/biome@1.9.0'] });
    expect(process.calls[0]?.args).toContain('@biomejs/biome@1.9.0');
  });

  it('throws ArtifactFetchError and leaves no marker when npm fails', async () => {
    const fs = new InMemoryFileSystem();
    const process = new FakeProcessRunner();
    process.enqueue({ stdout: '', stderr: 'network error', exitCode: 1 });
    const store = makeStore(fs, process);
    await expect(store.materialize(ref, { packageName: '@sentiness/check-biome' })).rejects.toBeInstanceOf(ArtifactFetchError);
    expect(await store.isMaterialized(ref)).toBe(false);
  });

  it('is idempotent: a materialized slot is not re-fetched', async () => {
    const fs = new InMemoryFileSystem({
      '/home/u/.sentiness/cache/checks/biome/1.3.0/.sentiness-materialized': 'x',
    });
    const process = new FakeProcessRunner();
    const store = makeStore(fs, process);
    await store.materialize(ref, { packageName: '@sentiness/check-biome' });
    expect(process.calls).toHaveLength(0);
  });
});
```

- [ ] **Step 7: Run it and verify it fails**

Run: `pnpm --filter @sentiness/core exec vitest run --config ../../vitest.config.base.ts src/cache/artifact-store.test.ts`
Expected: FAIL ("Cannot find module './artifact-store.js'").

- [ ] **Step 8: Implement `artifact-store.ts`**

Create `packages/core/src/cache/artifact-store.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import type { FileSystem, Logger, ProcessRunner } from '@sentiness/check-sdk';
import type { ArtifactRef, CachePaths } from './paths.js';

const MARKER = '.sentiness-materialized';

export class ArtifactFetchError extends Error {
  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options);
    this.name = 'ArtifactFetchError';
  }
}

export interface MaterializeOptions {
  readonly packageName: string;
  readonly extraInstalls?: readonly string[];
  readonly signal?: AbortSignal;
}

export interface MaterializeResult {
  readonly path: string;
  readonly integrity: string;
}

export interface ArtifactStore {
  slotPath(ref: ArtifactRef): string;
  isMaterialized(ref: ArtifactRef): Promise<boolean>;
  materialize(ref: ArtifactRef, options: MaterializeOptions): Promise<MaterializeResult>;
}

export interface ArtifactStoreDeps {
  readonly paths: CachePaths;
  readonly fs: FileSystem;
  readonly process: ProcessRunner;
  readonly logger: Logger;
  readonly randomId?: () => string;
}

async function readIntegrity(fs: FileSystem, root: string, packageName: string): Promise<string> {
  // Best-effort: npm writes node_modules/.package-lock.json with resolved integrity.
  const lockPath = join(root, 'node_modules', '.package-lock.json');
  if (!(await fs.exists(lockPath))) {
    return '';
  }
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(lockPath));
    const packages = (parsed as { packages?: Record<string, { integrity?: string }> }).packages ?? {};
    return packages[`node_modules/${packageName}`]?.integrity ?? '';
  } catch {
    return '';
  }
}

export function createArtifactStore(deps: ArtifactStoreDeps): ArtifactStore {
  const { paths, fs, process, logger } = deps;
  const randomId = deps.randomId ?? randomUUID;

  async function isMaterialized(ref: ArtifactRef): Promise<boolean> {
    return fs.exists(join(paths.slotPath(ref), MARKER));
  }

  return {
    slotPath: (ref) => paths.slotPath(ref),
    isMaterialized,
    async materialize(ref, options) {
      const slot = paths.slotPath(ref);
      if (await isMaterialized(ref)) {
        return { path: slot, integrity: ref.integrity ?? '' };
      }
      const tmp = join(paths.tmpDir(), randomId());
      await fs.mkdir(tmp, { recursive: true });
      await fs.writeFile(join(tmp, 'package.json'), JSON.stringify({ private: true }));

      const specs = [`${options.packageName}@${ref.version}`, ...(options.extraInstalls ?? [])];
      const result = await process.execFile(
        'npm',
        ['install', '--prefix', tmp, '--no-save', '--no-audit', '--no-fund', ...specs],
        options.signal ? { signal: options.signal } : {},
      );
      if (result.exitCode !== 0) {
        await fs.rm(tmp, { recursive: true, force: true });
        throw new ArtifactFetchError(`npm install failed for ${specs.join(' ')}: ${result.stderr.trim()}`);
      }

      const integrity = await readIntegrity(fs, tmp, options.packageName);
      if (ref.integrity && integrity && ref.integrity !== integrity) {
        await fs.rm(tmp, { recursive: true, force: true });
        throw new ArtifactFetchError(`integrity mismatch for ${options.packageName}@${ref.version}`);
      }

      await fs.writeFile(join(tmp, MARKER), new Date().toISOString());
      await fs.mkdir(dirname(slot), { recursive: true });
      if (await isMaterialized(ref)) {
        // Lost a concurrent race; discard our temp copy.
        await fs.rm(tmp, { recursive: true, force: true });
        return { path: slot, integrity: ref.integrity ?? integrity };
      }
      await fs.rename(tmp, slot);
      logger.debug('materialized artifact', { slot, package: options.packageName, version: ref.version });
      return { path: slot, integrity };
    },
  };
}
```

- [ ] **Step 9: Run the artifact-store tests and verify they pass**

Run: `pnpm --filter @sentiness/core exec vitest run --config ../../vitest.config.base.ts src/cache/`
Expected: PASS (both `paths.test.ts` and `artifact-store.test.ts`).

- [ ] **Step 10: Commit**

```bash
git add packages/core/src/cache/ packages/_test-utils/src/in-memory-fs.ts
git commit -m "feat(core): add cache paths and npm artifact store"
```

---

## Task 3: Lock schema + manager

Implements spec **TV1.2**. The `sentiness.lock` schema and a `LockManager` (load/save/`satisfies`). Lives in `@sentiness/core` (no separate bootstrap package — see spec §4).

**Files:**
- Create: `packages/core/src/lock/schema.ts`
- Create: `packages/core/src/lock/lock.ts`
- Create: `packages/core/src/lock/lock.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/lock/lock.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { InMemoryFileSystem } from '@sentiness/_test-utils';
import { resolveConfig, validateConfig } from '../config/config.js';
import { LockManager, LockParseError } from './lock.js';
import type { SentinessLock } from './schema.js';

const lock: SentinessLock = {
  lockfileVersion: 1,
  engine: { version: '2.0.0' },
  checks: { knip: { version: '1.0.0' }, biome: { version: '1.3.0' } },
};

const config = resolveConfig(
  validateConfig({
    schemaVersion: '2.0',
    engine: '2.0.0',
    checks: { biome: { version: '^1.3.0' }, knip: { version: '^1.0.0' } },
  }),
);

describe('LockManager', () => {
  it('returns undefined when the lock file is absent', async () => {
    expect(await LockManager.load('/p/sentiness.lock', new InMemoryFileSystem())).toBeUndefined();
  });

  it('save then load is identity, with check keys sorted', async () => {
    const fs = new InMemoryFileSystem();
    await LockManager.save('/p/sentiness.lock', lock, fs);
    const text = await fs.readFile('/p/sentiness.lock');
    expect(text.indexOf('"biome"')).toBeLessThan(text.indexOf('"knip"'));
    expect(await LockManager.load('/p/sentiness.lock', fs)).toEqual(lock);
  });

  it('throws LockParseError on malformed JSON', async () => {
    const fs = new InMemoryFileSystem({ '/p/sentiness.lock': '{ broken' });
    await expect(LockManager.load('/p/sentiness.lock', fs)).rejects.toBeInstanceOf(LockParseError);
  });

  it('satisfies: ok when engine and every check match', () => {
    expect(LockManager.satisfies(lock, config).ok).toBe(true);
  });

  it('satisfies: reports engine drift', () => {
    const result = LockManager.satisfies({ ...lock, engine: { version: '1.9.0' } }, config);
    expect(result.ok).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/engine/);
  });

  it('satisfies: reports a missing check', () => {
    const result = LockManager.satisfies({ ...lock, checks: { biome: { version: '1.3.0' } } }, config);
    expect(result.ok).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/knip/);
  });

  it('satisfies: a path-linked catalog entry matches a path lock entry', () => {
    const linkedConfig = resolveConfig(
      validateConfig({ schemaVersion: '2.0', engine: '2.0.0', checks: { biome: { path: 'packages/checks/biome' } } }),
    );
    const linkedLock: SentinessLock = { lockfileVersion: 1, engine: { version: '2.0.0' }, checks: { biome: { path: 'packages/checks/biome' } } };
    expect(LockManager.satisfies(linkedLock, linkedConfig).ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `pnpm --filter @sentiness/core exec vitest run --config ../../vitest.config.base.ts src/lock/lock.test.ts`
Expected: FAIL ("Cannot find module './lock.js'").

- [ ] **Step 3: Implement `schema.ts`**

Create `packages/core/src/lock/schema.ts`:

```ts
import { z } from 'zod';

const LockToolSchema = z.object({
  name: z.string(),
  ecosystem: z.enum(['npm', 'host']),
  version: z.string().optional(),
  integrity: z.string().optional(),
  detectedVersion: z.string().optional(),
  supported: z.string().optional(),
});

const LockCheckSchema = z.object({
  version: z.string().optional(),
  path: z.string().optional(),
  integrity: z.string().optional(),
  tool: LockToolSchema.optional(),
});

export const LockSchema = z.object({
  lockfileVersion: z.literal(1),
  engine: z.object({ version: z.string(), integrity: z.string().optional() }),
  checks: z.record(z.string(), LockCheckSchema),
});

export type LockTool = z.infer<typeof LockToolSchema>;
export type LockCheck = z.infer<typeof LockCheckSchema>;
export type SentinessLock = z.infer<typeof LockSchema>;
```

- [ ] **Step 4: Implement `lock.ts`**

Create `packages/core/src/lock/lock.ts`. Note: the repo already depends on `semver` indirectly is **not** guaranteed, so use a tiny range check via Node — but Zod/`cac` are the only deps. Implement a minimal satisfies using string-prefix tolerance is **not** acceptable; instead require an exact or caret/tilde match with a small helper. To avoid a new dependency, accept the locked version if it is non-empty and the catalog range is a caret/tilde/exact whose base the locked version starts at, OR equal. Keep the helper conservative and documented.

```ts
import { join } from 'node:path';
import type { FileSystem } from '@sentiness/check-sdk';
import type { ResolvedConfig } from '../config/config.js';
import { LockSchema, type SentinessLock } from './schema.js';

export class LockParseError extends Error {
  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options);
    this.name = 'LockParseError';
  }
}

export interface SatisfiesResult {
  readonly ok: boolean;
  readonly reasons: readonly string[];
}

// Minimal range check WITHOUT a semver dependency. Supports exact ('1.2.3'),
// caret ('^1.2.3' => same major, >= base) and tilde ('~1.2.3' => same major.minor,
// >= base). Anything else (e.g. '*', '>=', ranges) is treated as "any non-empty
// version satisfies", which is safe here because `install` always writes a concrete
// version into the lock and re-validates against the registry.
function parseVersion(v: string): [number, number, number] | undefined {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined;
}

export function rangeSatisfied(range: string, version: string): boolean {
  if (version.length === 0) {
    return false;
  }
  if (range === version) {
    return true;
  }
  const op = range.startsWith('^') ? '^' : range.startsWith('~') ? '~' : '';
  if (op === '') {
    return /^[*x]$/.test(range) || range.startsWith('>=') || range === version;
  }
  const base = parseVersion(range.slice(1));
  const got = parseVersion(version);
  if (!base || !got) {
    return false;
  }
  if (op === '^') {
    return got[0] === base[0] && (got[1] > base[1] || (got[1] === base[1] && got[2] >= base[2]));
  }
  return got[0] === base[0] && got[1] === base[1] && got[2] >= base[2];
}

export class LockManager {
  static async load(path: string, fs: FileSystem): Promise<SentinessLock | undefined> {
    if (!(await fs.exists(path))) {
      return undefined;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(await fs.readFile(path));
    } catch (error) {
      throw new LockParseError(`Invalid JSON in ${path}`, { cause: error });
    }
    const parsed = LockSchema.safeParse(raw);
    if (!parsed.success) {
      throw new LockParseError(`Invalid lock file ${path}: ${parsed.error.message}`, { cause: parsed.error });
    }
    return parsed.data;
  }

  static async save(path: string, lock: SentinessLock, fs: FileSystem): Promise<void> {
    const sortedChecks = Object.fromEntries(Object.entries(lock.checks).sort(([a], [b]) => a.localeCompare(b)));
    const ordered: SentinessLock = { ...lock, checks: sortedChecks };
    const tmp = `${path}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify(ordered, null, 2)}\n`);
    await fs.rename(tmp, path);
  }

  static satisfies(lock: SentinessLock, config: ResolvedConfig): SatisfiesResult {
    const reasons: string[] = [];
    if (!rangeSatisfied(config.engine, lock.engine.version)) {
      reasons.push(`engine: locked ${lock.engine.version} does not satisfy ${config.engine}`);
    }
    for (const [id, entry] of Object.entries(config.checks)) {
      const locked = lock.checks[id];
      if (!locked) {
        reasons.push(`check "${id}" is missing from the lock`);
        continue;
      }
      if (entry.path !== undefined) {
        if (locked.path !== entry.path) {
          reasons.push(`check "${id}" is path-linked to ${entry.path} but the lock has ${locked.path ?? locked.version}`);
        }
        continue;
      }
      if (entry.version !== undefined && !rangeSatisfied(entry.version, locked.version ?? '')) {
        reasons.push(`check "${id}": locked ${locked.version ?? '(none)'} does not satisfy ${entry.version}`);
      }
    }
    return { ok: reasons.length === 0, reasons };
  }
}
```

- [ ] **Step 5: Add a unit test for `rangeSatisfied` edge cases**

Append to `packages/core/src/lock/lock.test.ts`:

```ts
import { rangeSatisfied } from './lock.js';

describe('rangeSatisfied', () => {
  it.each([
    ['1.2.3', '1.2.3', true],
    ['^1.2.0', '1.5.0', true],
    ['^1.2.0', '2.0.0', false],
    ['~1.2.0', '1.2.9', true],
    ['~1.2.0', '1.3.0', false],
    ['*', '9.9.9', true],
    ['^1.0.0', '', false],
  ])('range %s vs version %s => %s', (range, version, expected) => {
    expect(rangeSatisfied(range, version)).toBe(expected);
  });
});
```

- [ ] **Step 6: Run all lock tests and verify they pass**

Run: `pnpm --filter @sentiness/core exec vitest run --config ../../vitest.config.base.ts src/lock/`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/lock/
git commit -m "feat(core): add sentiness.lock schema and manager"
```

---

## Task 4: Registry resolves from the cache (and path-linked packages)

Implements spec **TV1.4**. Rewrites `CheckRegistry.fromConfig` (which resolved `@sentiness/check-<id>` from the project's `node_modules`) into `fromResolved`, which imports each check from its cache slot or, for `path`-linked catalog entries, from a local package.

**Files:**
- Modify (rewrite): `packages/core/src/registry/registry.ts`
- Modify: `packages/core/src/registry/registry.test.ts`

- [ ] **Step 1: Write the failing test using a real on-disk fixture check**

Dynamic `import()` cannot be satisfied by the in-memory FS, so the test writes a tiny ESM check module to a temp dir and points a `path`-linked catalog at it. Replace `packages/core/src/registry/registry.test.ts` with:

```ts
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveConfig, validateConfig } from '../config/config.js';
import { CheckRegistry } from './registry.js';
import type { ArtifactRef, CachePaths } from '../cache/paths.js';
import type { ArtifactStore } from '../cache/artifact-store.js';
import type { SentinessLock } from '../lock/schema.js';

let repoRoot: string;

beforeAll(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'sentiness-reg-'));
  // A path-linked check at <repoRoot>/local-check/dist/index.js
  const pkg = join(repoRoot, 'local-check');
  mkdirSync(join(pkg, 'dist'), { recursive: true });
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: '@sentiness/check-demo', type: 'module', exports: { '.': './dist/index.js' } }));
  writeFileSync(
    join(pkg, 'dist', 'index.js'),
    `export default { id: 'demo', category: 'lint', defaultTier: 'fast', detect: async () => ({ available: true }), run: async () => ({ status: 'ok', findings: [], durationMs: 0 }) };\n`,
  );
});

afterAll(() => rmSync(repoRoot, { recursive: true, force: true }));

// A store stub: every check is "materialized" and its slot is the fixture dir.
function stubStore(slot: string): ArtifactStore {
  const paths: Pick<CachePaths, 'slotPath'> = { slotPath: () => slot };
  return {
    slotPath: (ref: ArtifactRef) => paths.slotPath(ref),
    isMaterialized: async () => true,
    materialize: async () => ({ path: slot, integrity: '' }),
  };
}

const emptyLock: SentinessLock = { lockfileVersion: 1, engine: { version: '2.0.0' }, checks: {} };

describe('CheckRegistry.fromResolved', () => {
  it('loads a path-linked check from a local package', async () => {
    const config = resolveConfig(
      validateConfig({ schemaVersion: '2.0', engine: '2.0.0', checks: { demo: { path: 'local-check' } } }),
    );
    const registry = await CheckRegistry.fromResolved(config, emptyLock, stubStore('/unused'), repoRoot);
    expect(registry.list().map((c) => c.id)).toEqual(['demo']);
    expect(registry.loadFailures()).toHaveLength(0);
  });

  it('records a load failure when a versioned check slot is not materialized', async () => {
    const config = resolveConfig(
      validateConfig({ schemaVersion: '2.0', engine: '2.0.0', checks: { biome: { version: '1.3.0' } } }),
    );
    const notMaterialized: ArtifactStore = { ...stubStore('/none'), isMaterialized: async () => false };
    const lock: SentinessLock = { lockfileVersion: 1, engine: { version: '2.0.0' }, checks: { biome: { version: '1.3.0' } } };
    const registry = await CheckRegistry.fromResolved(config, lock, notMaterialized, repoRoot);
    expect(registry.list()).toHaveLength(0);
    expect(registry.loadFailures()[0]?.message).toMatch(/sentiness install/);
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `pnpm --filter @sentiness/core exec vitest run --config ../../vitest.config.base.ts src/registry/registry.test.ts`
Expected: FAIL (current registry has `fromConfig`, not `fromResolved`).

- [ ] **Step 3: Rewrite `registry.ts`**

Replace the contents of `packages/core/src/registry/registry.ts` with:

```ts
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { asCheckId, type Category, type Check, type CheckId, type Tier } from '@sentiness/check-sdk';
import type { ArtifactStore } from '../cache/artifact-store.js';
import type { CatalogCheckEntry, ResolvedConfig } from '../config/config.js';
import type { SentinessLock } from '../lock/schema.js';

export type CheckLoadFailure = {
  readonly requestedId: CheckId;
  readonly source: string;
  readonly message: string;
};

export class CheckLoadError extends Error {
  constructor(message: string, readonly failure: CheckLoadFailure) {
    super(message);
    this.name = 'CheckLoadError';
  }
}

const categories: readonly Category[] = ['lint', 'architecture', 'test-quality', 'coverage', 'security', 'duplication', 'complexity', 'platform'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
function isCategory(value: unknown): value is Category {
  return typeof value === 'string' && categories.includes(value as Category);
}
function isTier(value: unknown): value is Tier {
  return value === 'fast' || value === 'standard' || value === 'slow';
}

function validateCheck(value: unknown): Check {
  if (!isRecord(value)) throw new Error('default export is not an object');
  if (typeof value.id !== 'string') throw new Error('check.id must be a string');
  if (!isCategory(value.category)) throw new Error('check.category is invalid');
  if (!isTier(value.defaultTier)) throw new Error('check.defaultTier is invalid');
  if (typeof value.detect !== 'function' || typeof value.run !== 'function') {
    throw new Error('check.detect and check.run must be functions');
  }
  return value as Check;
}

function validateConfigId(id: string): CheckId {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error(`Invalid check id "${id}"`);
  return asCheckId(id);
}

async function importDefault(entryFile: string): Promise<Check> {
  const moduleValue: unknown = await import(pathToFileURL(entryFile).href);
  if (!isRecord(moduleValue) || !('default' in moduleValue)) throw new Error('module has no default export');
  return validateCheck(moduleValue.default);
}

// Resolve the package main of an installed @sentiness/check-<id> living in a slot.
function checkEntryFile(slotDir: string, id: string): string {
  const requireFromSlot = createRequire(join(slotDir, 'package.json'));
  return requireFromSlot.resolve(`@sentiness/check-${id}`);
}

// Resolve the package main of a path-linked local check.
function linkedEntryFile(repoRoot: string, relPath: string): string {
  const pkgDir = join(repoRoot, relPath);
  const requireFromRepo = createRequire(join(repoRoot, 'package.json'));
  return requireFromRepo.resolve(pkgDir);
}

export class CheckRegistry {
  private constructor(
    private readonly checks: readonly Check[],
    private readonly failures: readonly CheckLoadFailure[],
    private readonly tierOverrides: ReadonlyMap<CheckId, Tier>,
  ) {}

  static async fromResolved(
    config: ResolvedConfig,
    lock: SentinessLock,
    store: ArtifactStore,
    repoRoot: string,
  ): Promise<CheckRegistry> {
    const checks: Check[] = [];
    const failures: CheckLoadFailure[] = [];
    const tierOverrides = new Map<CheckId, Tier>();

    for (const [rawId, entry] of Object.entries(config.checks) as [string, CatalogCheckEntry][]) {
      let id: CheckId;
      try {
        id = validateConfigId(rawId);
      } catch (error) {
        failures.push({ requestedId: asCheckId(rawId), source: rawId, message: error instanceof Error ? error.message : 'invalid id' });
        continue;
      }
      if (entry.tier && isTier(entry.tier)) tierOverrides.set(id, entry.tier);

      try {
        if (entry.path !== undefined) {
          checks.push(await importDefault(linkedEntryFile(repoRoot, entry.path)));
          continue;
        }
        const version = lock.checks[rawId]?.version;
        const ref = { kind: 'check', id: rawId, version: version ?? '' } as const;
        if (!version || !(await store.isMaterialized(ref))) {
          failures.push({ requestedId: id, source: `@sentiness/check-${rawId}`, message: `check "${rawId}" is not in the cache — run \`sentiness install\`` });
          continue;
        }
        checks.push(await importDefault(checkEntryFile(store.slotPath(ref), rawId)));
      } catch (error) {
        failures.push({ requestedId: id, source: `@sentiness/check-${rawId}`, message: error instanceof Error ? error.message : 'unknown load error' });
      }
    }
    return new CheckRegistry(checks, failures, tierOverrides);
  }

  list(): readonly Check[] {
    return this.checks;
  }
  get(id: CheckId): Check | undefined {
    return this.checks.find((c) => c.id === id);
  }
  filterByTier(tier: Tier): readonly Check[] {
    return this.checks.filter((c) => (this.tierOverrides.get(c.id) ?? c.defaultTier) === tier);
  }
  loadFailures(): readonly CheckLoadFailure[] {
    return this.failures;
  }
}
```

- [ ] **Step 4: Run the registry tests and verify they pass**

Run: `pnpm --filter @sentiness/core exec vitest run --config ../../vitest.config.base.ts src/registry/registry.test.ts`
Expected: PASS.

- [ ] **Step 5: Update callers of the old `fromConfig` and typecheck**

Search for `fromConfig`: `git grep -n "CheckRegistry.fromConfig"`. Each caller (the runner wiring, `doctor`, `check`, `install` once it exists) must call `fromResolved(config, lock, store, repoRoot)`. For callers fully rewritten in later tasks (Task 6 `install`; the runner is V2), patch minimally now: build a `store` via `createArtifactStore` and load the lock via `LockManager.load`. Run `pnpm --filter @sentiness/core typecheck` and resolve every error.

Run: `pnpm --filter @sentiness/core typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/registry/
git commit -m "feat(core)!: resolve checks from the cache instead of project node_modules"
```

---

## Task 5: Checks bundle their npm tool; ProcessRunner resolves slot bins

Implements spec **TV1.7**. npm-tool checks declare their tool as an exact dependency (so the tool is pinned by the check version and materialized into the check's slot). The `ProcessRunner` is taught to prepend a check's slot `.bin` to `PATH`, threaded via a new `CheckContext.binPaths`.

**Files:**
- Modify: `packages/check-sdk/src/types.ts` (add `CheckContext.binPaths`)
- Modify: `packages/core/src/process/process-runner.ts`
- Modify: `packages/core/src/process/process-runner.test.ts`
- Modify: `packages/checks/biome/package.json`, `packages/checks/eslint/package.json`, `packages/checks/knip/package.json`, `packages/checks/jscpd/package.json`

- [ ] **Step 1: Add `binPaths` to `CheckContext` and `ExecFileOptions`**

In `packages/check-sdk/src/types.ts`, add `readonly binPaths?: readonly string[];` to the `CheckContext` interface (additive). Add `readonly binPaths?: readonly string[];` to `ExecFileOptions` as well (so a check can pass its slot bins through to `execFile`). Add a type-level assertion in `packages/check-sdk/src/types.test.ts`:

```ts
import { expectTypeOf } from 'vitest';
import type { CheckContext, ExecFileOptions } from './types.js';

expectTypeOf<CheckContext['binPaths']>().toEqualTypeOf<readonly string[] | undefined>();
expectTypeOf<ExecFileOptions['binPaths']>().toEqualTypeOf<readonly string[] | undefined>();
```

Run: `pnpm --filter @sentiness/check-sdk test`
Expected: PASS.

- [ ] **Step 2: Write the failing ProcessRunner test for slot bins**

Add to `packages/core/src/process/process-runner.test.ts` a test that a configured slot bin is prepended to `PATH`. Use a tiny script that echoes a tool found only in the slot bin. Minimal version asserting PATH composition via a printenv-style command:

```ts
import { describe, expect, it } from 'vitest';
import { delimiter } from 'node:path';
import { createProcessRunner } from './process-runner.js';

describe('NodeProcessRunner binPaths', () => {
  it('prepends binPaths ahead of cwd node_modules/.bin on PATH', async () => {
    const runner = createProcessRunner();
    // `node -e` prints PATH so we can assert ordering deterministically.
    const result = await runner.execFile('node', ['-e', 'process.stdout.write(process.env.PATH ?? "")'], {
      cwd: '/tmp',
      binPaths: ['/slots/biome/node_modules/.bin'],
    });
    const path = result.stdout;
    expect(path.startsWith(`/slots/biome/node_modules/.bin${delimiter}`)).toBe(true);
    expect(path.indexOf('/slots/biome/node_modules/.bin')).toBeLessThan(path.indexOf(`/tmp${delimiter}node_modules`.replace('/tmp', '')));
  });
});
```

Note: keep the second assertion simple — at minimum assert the slot bin appears and is at index 0.

- [ ] **Step 3: Run it and verify it fails**

Run: `pnpm --filter @sentiness/core exec vitest run --config ../../vitest.config.base.ts src/process/process-runner.test.ts`
Expected: FAIL (binPaths is ignored today; slot bin not on PATH).

- [ ] **Step 4: Implement slot-bin support in `process-runner.ts`**

Modify `envWithLocalBins` to accept and prepend `binPaths` ahead of the cwd-derived bins, and pass `options.binPaths` through in `execFile`:

```ts
function envWithLocalBins(
  cwd: string | undefined,
  extra: Readonly<Record<string, string>> | undefined,
  binPaths: readonly string[] | undefined,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...(extra ?? {}) };
  const prefixes: string[] = [...(binPaths ?? [])];
  if (cwd) {
    prefixes.push(...localBinPaths(cwd));
  }
  if (prefixes.length > 0) {
    const prefix = prefixes.join(delimiter);
    env.PATH = env.PATH ? `${prefix}${delimiter}${env.PATH}` : prefix;
  }
  return env;
}
```

And in `execFile`, change the env call to:

```ts
        env: envWithLocalBins(options?.cwd, options?.env, options?.binPaths),
```

- [ ] **Step 5: Run the ProcessRunner test and verify it passes**

Run: `pnpm --filter @sentiness/core exec vitest run --config ../../vitest.config.base.ts src/process/process-runner.test.ts`
Expected: PASS.

- [ ] **Step 6: Make each npm-tool check declare its tool dependency**

Edit each `package.json` `dependencies` block, adding the tool at the exact version the check currently targets (read the check's own README/normalize to confirm the major). Use these:

- `packages/checks/biome/package.json`: add `"@biomejs/biome": "2.0.0"`.
- `packages/checks/eslint/package.json`: add `"eslint": "9.0.0"`.
- `packages/checks/knip/package.json`: add `"knip": "5.0.0"`.
- `packages/checks/jscpd/package.json`: add `"jscpd": "4.0.0"`.

(Exact patch versions can be the latest of that major; the point is the tool is now a pinned dependency, not expected on the project's PATH. `osv-scanner`, `semgrep`, `dependency-cruiser`, `lockfile-lint`, `coverage`, `deps-diff`, `stryker`, `playwright` are NOT changed here: the first two are non-npm host tools; the rest either need no tool or are handled later.)

- [ ] **Step 7: Verify the workspace still installs and the changed checks typecheck**

Run: `pnpm install` then `pnpm --filter @sentiness/check-biome typecheck`
Expected: install succeeds; typecheck passes. (The tool is now a real dependency.)

- [ ] **Step 8: Commit**

```bash
git add packages/check-sdk/src/types.ts packages/check-sdk/src/types.test.ts packages/core/src/process/ packages/checks/biome/package.json packages/checks/eslint/package.json packages/checks/knip/package.json packages/checks/jscpd/package.json pnpm-lock.yaml
git commit -m "feat(core): bundle npm tools into check slots and resolve their bins"
```

---

## Task 6: `sentiness install` + `--cache-root` engine entrypoint

Implements spec **TV1.6**. Adds the `install` command (resolve ranges → exact, write the lock, materialize the engine's sibling check slots), threads `--cache-root` from the launcher into `CommandDeps`, and removes the global `bin` from `@sentiness/core`.

**Files:**
- Create: `packages/core/src/cli/commands/install.ts`
- Create: `packages/core/src/cli/commands/install.test.ts`
- Modify: `packages/core/src/cli/commands/types.ts` (add `cacheRoot`)
- Modify: `packages/core/src/cli/index.ts` (parse `--cache-root`, build store, pass `cacheRoot`)
- Modify: `packages/core/src/cli/commands/registry.ts` (register `install`)
- Modify: `packages/core/package.json` (remove the `bin` field)

- [ ] **Step 1: Add `cacheRoot` to `CommandDeps`**

In `packages/core/src/cli/commands/types.ts`, add to `CommandDeps`:

```ts
  readonly cacheRoot: string; // resolved by the launcher, passed via --cache-root
```

- [ ] **Step 2: Write the failing install test**

Create `packages/core/src/cli/commands/install.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { FakeProcessRunner, FixedClock, InMemoryFileSystem, InMemoryGitProvider, SilentLogger } from '@sentiness/_test-utils';
import type { CommandDeps } from './types.js';
import { installCommand } from './install.js';

function deps(fs: InMemoryFileSystem, processRunner: FakeProcessRunner): CommandDeps {
  return {
    cwd: '/project',
    cacheRoot: '/home/u/.sentiness',
    fs,
    processRunner,
    logger: new SilentLogger(),
    clock: new FixedClock(0),
    git: new InMemoryGitProvider(),
    stdout: { write: () => {} },
  };
}

const config = {
  schemaVersion: '2.0',
  engine: '^2.0.0',
  checks: { biome: { version: '^1.3.0' } },
};

describe('installCommand', () => {
  it('resolves ranges, writes the lock, and materializes slots (non-frozen)', async () => {
    const fs = new InMemoryFileSystem({ '/project/sentiness.config.json': JSON.stringify(config) });
    const process = new FakeProcessRunner();
    // npm view @sentiness/core@^2.0.0 version --json
    process.enqueue({ stdout: '"2.0.1"', stderr: '', exitCode: 0 });
    // npm view @sentiness/check-biome@^1.3.0 version --json
    process.enqueue({ stdout: '"1.3.4"', stderr: '', exitCode: 0 });
    // npm install (engine slot) then npm install (check slot)
    process.enqueue({ stdout: '', stderr: '', exitCode: 0 });
    process.enqueue({ stdout: '', stderr: '', exitCode: 0 });
    // detect() for host tool fields runs through the registry import — but biome's tool is npm, so no host detect call.

    const code = await installCommand({ frozen: false }, deps(fs, process));
    expect(code).toBe(0);
    const lock = JSON.parse(await fs.readFile('/project/sentiness.lock'));
    expect(lock.engine.version).toBe('2.0.1');
    expect(lock.checks.biome.version).toBe('1.3.4');
  });

  it('--frozen fails when the lock is missing', async () => {
    const fs = new InMemoryFileSystem({ '/project/sentiness.config.json': JSON.stringify(config) });
    const code = await installCommand({ frozen: true }, deps(fs, new FakeProcessRunner()));
    expect(code).toBe(3);
  });
});
```

- [ ] **Step 3: Run it and verify it fails**

Run: `pnpm --filter @sentiness/core exec vitest run --config ../../vitest.config.base.ts src/cli/commands/install.test.ts`
Expected: FAIL ("Cannot find module './install.js'").

- [ ] **Step 4: Implement `install.ts`**

Create `packages/core/src/cli/commands/install.ts`:

```ts
import { createArtifactStore } from '../../cache/artifact-store.js';
import { createCachePaths } from '../../cache/paths.js';
import { loadConfig, type ResolvedConfig } from '../../config/config.js';
import { LockManager } from '../../lock/lock.js';
import type { LockCheck, SentinessLock } from '../../lock/schema.js';
import type { CommandDeps } from './types.js';

export interface InstallOptions {
  readonly frozen: boolean;
  readonly signal?: AbortSignal;
}

async function npmResolveVersion(deps: CommandDeps, pkg: string, range: string): Promise<string> {
  const result = await deps.processRunner.execFile('npm', ['view', `${pkg}@${range}`, 'version', '--json']);
  if (result.exitCode !== 0) {
    throw new Error(`npm view failed for ${pkg}@${range}: ${result.stderr.trim()}`);
  }
  const parsed: unknown = JSON.parse(result.stdout);
  // npm returns a string for one match, or an array (ascending) for several.
  if (typeof parsed === 'string') return parsed;
  if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed.at(-1) === 'string') return parsed.at(-1) as string;
  throw new Error(`Could not resolve a version for ${pkg}@${range}`);
}

export async function installCommand(options: InstallOptions, deps: CommandDeps): Promise<number> {
  const config: ResolvedConfig = await loadConfig(deps.cwd, deps.fs);
  const lockPath = `${deps.cwd}/sentiness.lock`;
  const store = createArtifactStore({
    paths: createCachePaths(deps.cacheRoot),
    fs: deps.fs,
    process: deps.processRunner,
    logger: deps.logger,
  });

  if (options.frozen) {
    const existing = await LockManager.load(lockPath, deps.fs);
    if (!existing) {
      deps.logger.error('sentiness.lock not found — run `sentiness install` to create it');
      return 3;
    }
    const verdict = LockManager.satisfies(existing, config);
    if (!verdict.ok) {
      deps.logger.error(`sentiness.lock does not satisfy the config:\n- ${verdict.reasons.join('\n- ')}`);
      return 3;
    }
    await materializeAll(existing, config, store, options.signal);
    deps.stdout.write(`${JSON.stringify({ installed: true, frozen: true })}\n`);
    return 0;
  }

  const engineVersion = await npmResolveVersion(deps, '@sentiness/core', config.engine);
  const engineResult = await store.materialize(
    { kind: 'engine', id: 'core', version: engineVersion },
    { packageName: '@sentiness/core', ...(options.signal ? { signal: options.signal } : {}) },
  );

  const checks: Record<string, LockCheck> = {};
  for (const [id, entry] of Object.entries(config.checks)) {
    if (entry.path !== undefined) {
      checks[id] = { path: entry.path };
      continue;
    }
    const version = await npmResolveVersion(deps, `@sentiness/check-${id}`, entry.version ?? '*');
    const result = await store.materialize(
      { kind: 'check', id, version },
      {
        packageName: `@sentiness/check-${id}`,
        ...(entry.toolVersion ? { extraInstalls: [`@is-tool-${id}@${entry.toolVersion}`] } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
      },
    );
    checks[id] = { version, ...(result.integrity ? { integrity: result.integrity } : {}) };
  }

  const lock: SentinessLock = {
    lockfileVersion: 1,
    engine: { version: engineVersion, ...(engineResult.integrity ? { integrity: engineResult.integrity } : {}) },
    checks,
  };
  await LockManager.save(lockPath, lock, deps.fs);
  deps.stdout.write(`${JSON.stringify({ installed: true, engine: engineVersion })}\n`);
  return 0;
}

async function materializeAll(
  lock: SentinessLock,
  config: ResolvedConfig,
  store: ReturnType<typeof createArtifactStore>,
  signal: AbortSignal | undefined,
): Promise<void> {
  await store.materialize(
    { kind: 'engine', id: 'core', version: lock.engine.version },
    { packageName: '@sentiness/core', ...(signal ? { signal } : {}) },
  );
  for (const [id, entry] of Object.entries(config.checks)) {
    if (entry.path !== undefined) continue;
    const locked = lock.checks[id];
    if (!locked?.version) continue;
    await store.materialize(
      { kind: 'check', id, version: locked.version },
      { packageName: `@sentiness/check-${id}`, ...(signal ? { signal } : {}) },
    );
  }
}
```

Note for the implementer: the `extraInstalls` tool-name placeholder above (`@is-tool-${id}`) is wrong on purpose to force you to wire the real tool name. Replace it: the npm tool name per check is the same map the wizard uses (`init-plan.ts` `EXTERNAL_TOOL_PACKAGES`). Import that map (export it from `init-plan.ts`) and use `EXTERNAL_TOOL_PACKAGES[id]` to build `[`${tool}@${entry.toolVersion}`]`. If the check has no npm tool, do not pass `extraInstalls`.

- [ ] **Step 5: Wire the real tool map and re-run**

Export `EXTERNAL_TOOL_PACKAGES` from `packages/core/src/cli/commands/init-plan.ts`, import it in `install.ts`, and replace the placeholder so `extraInstalls` uses the real tool name. Run:
`pnpm --filter @sentiness/core exec vitest run --config ../../vitest.config.base.ts src/cli/commands/install.test.ts`
Expected: PASS.

- [ ] **Step 6: Register `install` and thread `--cache-root` through the engine entrypoint**

In `packages/core/src/cli/commands/registry.ts`, import `installCommand` and register:

```ts
  cli
    .command('install', 'Resolve pinned versions, write sentiness.lock, and warm the cache')
    .option('--frozen', 'Require an existing lock that satisfies the config; do not re-resolve')
    .action(wrap((args, deps) => installCommand({ frozen: args.frozen === true }, deps), deps));
```

In `packages/core/src/cli/index.ts`, parse a hidden `--cache-root` (default to a sane fallback so the engine still runs if invoked directly) and add it to `deps`:

```ts
  const cacheRootIndex = argv.indexOf('--cache-root');
  const cacheRoot = cacheRootIndex >= 0 ? (argv[cacheRootIndex + 1] ?? '') : join(homedir(), '.sentiness');
```

Add `cacheRoot` to the `deps` object. Import `homedir` from `node:os` and `join` from `node:path`. Strip the `--cache-root <value>` pair from the argv passed to `cac` so it is not treated as a command/option (filter it out before `cli.parse`).

- [ ] **Step 7: Remove the `bin` from `@sentiness/core`**

In `packages/core/package.json`, delete the `"bin": { "sentiness": "./dist/cli/index.js" }` block. The global `sentiness` command now belongs solely to `@sentiness/cli` (Task 7). The engine CLI is still invoked as `node .../dist/cli/index.js`.

- [ ] **Step 8: Build, typecheck, and run the full core suite**

Run: `pnpm --filter @sentiness/core typecheck && pnpm --filter @sentiness/core test`
Expected: PASS. Fix any caller that constructed `CommandDeps` without `cacheRoot` (tests, `cli/index.ts`).

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/cli/ packages/core/package.json
git commit -m "feat(core): add sentiness install command and --cache-root engine entrypoint"
```

---

## Task 7: Thin launcher `@sentiness/cli`

Implements spec **TV1.5**. A new, self-contained package that owns the global `sentiness` bin: it resolves the cache root, peeks the engine pin + lock, npm-fetches the engine if missing, and spawns it.

**Files:**
- Create: `packages/cli/package.json`
- Create: `packages/cli/tsconfig.json`
- Create: `packages/cli/src/index.ts`
- Create: `packages/cli/src/bootstrap.ts`
- Create: `packages/cli/src/bootstrap.test.ts`
- Create: `packages/cli/README.md`

- [ ] **Step 1: Scaffold the package**

Create `packages/cli/package.json`:

```json
{
  "name": "@sentiness/cli",
  "version": "0.1.0",
  "description": "Thin global launcher for Sentiness: resolves the pinned engine and dispatches.",
  "license": "MIT",
  "type": "module",
  "bin": { "sentiness": "./dist/index.js" },
  "engines": { "node": ">=20.10" },
  "files": ["dist", "README.md"],
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "scripts": {
    "build": "node ../../scripts/clean-dist.mjs && tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run --config ../../vitest.config.base.ts src"
  },
  "dependencies": { "@sentiness/check-sdk": "workspace:*" },
  "devDependencies": { "@sentiness/_test-utils": "workspace:*", "typescript": "latest", "vitest": "latest" }
}
```

Create `packages/cli/tsconfig.json`:

```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "outDir": "dist", "rootDir": "src" }, "include": ["src"] }
```

Create `packages/cli/README.md` with one paragraph: "The thin global launcher. Reads the project's engine pin + sentiness.lock, fetches `@sentiness/core` at the pinned version into `~/.sentiness/cache`, and spawns it. Install once with `npm i -g @sentiness/cli`."

(`@sentiness/check-sdk` is a dependency only for the `FileSystem`/`ProcessRunner`/`Logger` types — the launcher uses the same abstractions but its own tiny fetch.)

- [ ] **Step 2: Write the failing bootstrap test**

Create `packages/cli/src/bootstrap.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { FakeProcessRunner, InMemoryFileSystem, SilentLogger } from '@sentiness/_test-utils';
import { run } from './bootstrap.js';

function baseDeps(fs: InMemoryFileSystem, processRunner: FakeProcessRunner) {
  const out: string[] = [];
  const err: string[] = [];
  return {
    deps: {
      cwd: '/project',
      env: { SENTINESS_HOME: '/home/u/.sentiness' },
      fs,
      process: processRunner,
      logger: new SilentLogger(),
      stdout: { write: (t: string) => out.push(t) },
      stderr: { write: (t: string) => err.push(t) },
    },
    out,
    err,
  };
}

const config = JSON.stringify({ schemaVersion: '2.0', engine: '2.0.0', checks: { biome: { version: '1.3.0' } } });
const lock = JSON.stringify({ lockfileVersion: 1, engine: { version: '2.0.0' }, checks: { biome: { version: '1.3.0' } } });

describe('launcher run', () => {
  it('exits 3 with a helpful message when no config is found', async () => {
    const { deps, err } = baseDeps(new InMemoryFileSystem(), new FakeProcessRunner());
    expect(await run(['check'], deps)).toBe(3);
    expect(err.join('')).toMatch(/sentiness.config/);
  });

  it('exits 3 telling the user to run install when the lock is absent', async () => {
    const fs = new InMemoryFileSystem({ '/project/sentiness.config.json': config });
    const { deps, err } = baseDeps(fs, new FakeProcessRunner());
    expect(await run(['check'], deps)).toBe(3);
    expect(err.join('')).toMatch(/sentiness install/);
  });

  it('fetches the engine if missing and spawns it with --cache-root, forwarding the exit code', async () => {
    const fs = new InMemoryFileSystem({ '/project/sentiness.config.json': config, '/project/sentiness.lock': lock });
    const process = new FakeProcessRunner();
    process.enqueue({ stdout: '', stderr: '', exitCode: 0 }); // npm install (engine)
    process.enqueue({ stdout: 'REPORT', stderr: '', exitCode: 1 }); // node engine cli (exit 1 = findings)
    const { deps, out } = baseDeps(fs, process);

    const code = await run(['check', '--tier=fast'], deps);

    const installCall = process.calls[0];
    expect(installCall?.command).toBe('npm');
    expect(installCall?.args).toContain('@sentiness/core@2.0.0');
    const spawnCall = process.calls[1];
    expect(spawnCall?.command).toBe('node');
    expect(spawnCall?.args).toContain('--cache-root');
    expect(spawnCall?.args).toContain('/home/u/.sentiness');
    expect(spawnCall?.args).toContain('check');
    expect(out.join('')).toBe('REPORT');
    expect(code).toBe(1);
  });
});
```

- [ ] **Step 3: Run it and verify it fails**

Run: `pnpm --filter @sentiness/cli exec vitest run --config ../../vitest.config.base.ts src/bootstrap.test.ts`
Expected: FAIL ("Cannot find module './bootstrap.js'").

- [ ] **Step 4: Implement `bootstrap.ts`**

Create `packages/cli/src/bootstrap.ts`:

```ts
import { join } from 'node:path';
import type { FileSystem, Logger, ProcessRunner } from '@sentiness/check-sdk';

export interface LauncherDeps {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly fs: FileSystem;
  readonly process: ProcessRunner;
  readonly logger: Logger;
  readonly stdout: { write(text: string): void };
  readonly stderr: { write(text: string): void };
}

const MARKER = '.sentiness-materialized';

function cacheRootFrom(env: Readonly<Record<string, string>>): string {
  return env.SENTINESS_HOME ?? join(env.HOME ?? env.USERPROFILE ?? '.', '.sentiness');
}

async function readJson(fs: FileSystem, path: string): Promise<Record<string, unknown> | undefined> {
  if (!(await fs.exists(path))) return undefined;
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(path));
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

export async function run(argv: readonly string[], deps: LauncherDeps): Promise<number> {
  // Dev bypass: a local engine checkout.
  const enginePathOverride = deps.env.SENTINESS_ENGINE_PATH;

  const config =
    (await readJson(deps.fs, join(deps.cwd, 'sentiness.config.json'))) ??
    (await readJson(deps.fs, join(deps.cwd, 'sentiness.config.js')));
  if (!config && !enginePathOverride) {
    deps.stderr.write('No sentiness.config.json found. Run `sentiness init` first.\n');
    return 3;
  }

  const cacheRoot = cacheRootFrom(deps.env);

  if (enginePathOverride) {
    return spawnEngine(deps, join(enginePathOverride, 'dist', 'cli', 'index.js'), cacheRoot, argv);
  }

  const lock = await readJson(deps.fs, join(deps.cwd, 'sentiness.lock'));
  const engineVersion = (lock?.engine as { version?: string } | undefined)?.version;
  if (!engineVersion) {
    deps.stderr.write('sentiness.lock is missing or has no engine version. Run `sentiness install`.\n');
    return 3;
  }

  const engineSlot = join(cacheRoot, 'cache', 'engine', engineVersion);
  if (!(await deps.fs.exists(join(engineSlot, MARKER)))) {
    const fetched = await fetchEngine(deps, engineSlot, engineVersion);
    if (fetched !== 0) return fetched;
  }
  return spawnEngine(deps, join(engineSlot, 'node_modules', '@sentiness', 'core', 'dist', 'cli', 'index.js'), cacheRoot, argv);
}

async function fetchEngine(deps: LauncherDeps, slot: string, version: string): Promise<number> {
  await deps.fs.mkdir(slot, { recursive: true });
  await deps.fs.writeFile(join(slot, 'package.json'), JSON.stringify({ private: true }));
  const result = await deps.process.execFile('npm', ['install', '--prefix', slot, '--no-save', '--no-audit', '--no-fund', `@sentiness/core@${version}`]);
  if (result.exitCode !== 0) {
    deps.stderr.write(`Failed to fetch @sentiness/core@${version}: ${result.stderr.trim()}\n`);
    return 3;
  }
  await deps.fs.writeFile(join(slot, MARKER), new Date().toISOString());
  return 0;
}

async function spawnEngine(deps: LauncherDeps, engineEntry: string, cacheRoot: string, argv: readonly string[]): Promise<number> {
  const result = await deps.process.execFile('node', [engineEntry, '--cache-root', cacheRoot, ...argv], { cwd: deps.cwd });
  if (result.stdout.length > 0) deps.stdout.write(result.stdout);
  if (result.stderr.length > 0) deps.stderr.write(result.stderr);
  return result.exitCode;
}
```

Note: the real Node entrypoint (Step 6) must stream stdio live rather than buffering (long checks). The buffered version above is what the unit test asserts; in `index.ts`, prefer `spawn` with `stdio: 'inherit'` for stdout/stderr and resolve on `close`. The `bootstrap.ts` `run()` stays testable by keeping the `ProcessRunner` seam; the production `index.ts` may pass a streaming `ProcessRunner` or call `spawn` directly at the boundary.

- [ ] **Step 5: Run the bootstrap test and verify it passes**

Run: `pnpm --filter @sentiness/cli exec vitest run --config ../../vitest.config.base.ts src/bootstrap.test.ts`
Expected: PASS.

- [ ] **Step 6: Implement the Node entrypoint `index.ts`**

Create `packages/cli/src/index.ts`:

```ts
#!/usr/bin/env node
import { writeSync } from 'node:fs';
import process from 'node:process';
import { createNodeFileSystem } from '@sentiness/core/node-fs'; // see note
import { createProcessRunner } from '@sentiness/core/process'; // see note
import { createLogger } from '@sentiness/core/logger'; // see note
import { run } from './bootstrap.js';

// NOTE: @sentiness/cli must NOT depend on @sentiness/core (it fetches core).
// Provide tiny local Node implementations of FileSystem / ProcessRunner / Logger
// inside packages/cli/src/ instead of importing from core. Replace the three
// imports above with local modules: ./node-fs.js, ./node-process.js, ./logger.js.

async function main(): Promise<void> {
  const deps = {
    cwd: process.cwd(),
    env: process.env as Record<string, string>,
    fs: createNodeFileSystem(),
    process: createProcessRunner(),
    logger: createLogger(),
    stdout: { write: (t: string) => writeSync(process.stdout.fd, t) },
    stderr: { write: (t: string) => writeSync(process.stderr.fd, t) },
  };
  const code = await run(process.argv.slice(2), deps);
  process.exitCode = code;
}

await main();
```

Because the launcher must not depend on `@sentiness/core`, create three tiny local modules in `packages/cli/src/`: `node-fs.ts` (a `FileSystem` over `node:fs/promises` — copy the minimal methods the launcher uses: `exists`, `readFile`, `writeFile`, `mkdir`, `rename`), `node-process.ts` (a `ProcessRunner` that `spawn`s with `stdio: 'inherit'` for the engine and `execFile` for npm), and `logger.ts` (a stderr `Logger`). Keep them under ~30 lines each. Update the imports in `index.ts` to the local modules.

- [ ] **Step 7: Add the package to the workspace install and build**

Run: `pnpm install && pnpm --filter @sentiness/cli build && pnpm --filter @sentiness/cli typecheck`
Expected: install links the new package; build + typecheck pass.

- [ ] **Step 8: Wire release + workspace config**

- Add `@sentiness/cli` to `scripts/check-release-packages.mjs` allowlist (mirror an existing entry).
- Confirm `pnpm-workspace.yaml` already globs `packages/*` (it does) — no change needed.
- Add a Changeset: `pnpm changeset` → select `@sentiness/cli` (and `@sentiness/core` for the breaking change) → minor/major as appropriate.

- [ ] **Step 9: Commit**

```bash
git add packages/cli/ scripts/check-release-packages.mjs .changeset/ pnpm-lock.yaml
git commit -m "feat(cli): add thin global launcher (@sentiness/cli)"
```

---

## Task 8: Manual end-to-end smoke (dogfood V1 in this repo)

Validates the whole V1 spine against this repository using `path`-linked checks (no npm fetch needed for unpublished workspace checks). This is the V1 slice of spec **TV4.1**; the full E2E suite (TV4.3) lands with V4.

**Files:**
- Modify: `sentiness.config.json` (this repo → v2, path-linked checks)
- Create: `sentiness.lock` (generated)

- [ ] **Step 1: Rewrite this repo's `sentiness.config.json` to v2**

Replace it with a v2 config whose checks are `path`-linked to the workspace packages and whose engine is path-bypassed via `SENTINESS_ENGINE_PATH`:

```json
{
  "schemaVersion": "2.0",
  "engine": "0.1.4",
  "checks": {
    "biome": { "path": "packages/checks/biome" },
    "knip": { "path": "packages/checks/knip" },
    "deps-diff": { "path": "packages/checks/deps-diff" }
  }
}
```

- [ ] **Step 2: Build everything**

Run: `pnpm build`
Expected: all packages build, including `@sentiness/cli` and `@sentiness/core`.

- [ ] **Step 3: Generate the lock via the engine directly (path-linked checks need no fetch)**

Run: `node packages/core/dist/cli/index.js --cache-root "$PWD/.sentiness/home" install`
Expected: exits 0; writes `sentiness.lock` with `engine` resolved and `checks.biome.path` etc. (Path-linked checks record `{ path }`, no fetch.)

- [ ] **Step 4: Run a check through the launcher with the dev engine bypass**

Run: `SENTINESS_ENGINE_PATH="$PWD/packages/core" node packages/cli/dist/index.js check --tier=fast --compact`
Expected: prints a JSON report to stdout (the launcher spawned the local engine with `--cache-root`); exit code reflects findings. Logs go to stderr.

- [ ] **Step 5: Verify determinism gate**

Run: `node packages/core/dist/cli/index.js --cache-root "$PWD/.sentiness/home" install --frozen`
Expected: exits 0 (the lock from Step 3 satisfies the config). Then hand-edit `sentiness.lock` to a bad engine version and re-run; expected: exits 3 with a clear reason. Restore the lock afterward.

- [ ] **Step 6: Run the standard gates**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: PASS. Add `.sentiness/home/` to `.gitignore` (the local cache used for the smoke test must not be committed).

- [ ] **Step 7: Commit**

```bash
git add sentiness.config.json sentiness.lock .gitignore
git commit -m "chore: migrate this repo to Sentiness v2 config (dogfood V1)"
```

---

## Self-Review

**Spec coverage (TV1.1–TV1.7):**
- TV1.1 config v2 → Task 1. ✓
- TV1.2 lock → Task 3. ✓
- TV1.3 cache + artifact store → Task 2. ✓
- TV1.4 registry from cache → Task 4. ✓
- TV1.5 thin launcher → Task 7. ✓
- TV1.6 install + `--cache-root` + remove core `bin` → Task 6. ✓
- TV1.7 checks declare npm tools + ProcessRunner slot bins → Task 5. ✓
- V1 slice of TV4.1 (dogfood) → Task 8. ✓ (Full E2E TV4.3 deferred to V4 — out of this plan's scope by design.)

**Type consistency check:**
- `ResolvedConfig` (Task 1) is consumed by `LockManager.satisfies` (Task 3), `CheckRegistry.fromResolved` (Task 4), and `installCommand` (Task 6) — same shape (`engine: string`, `checks: Record<string, CatalogCheckEntry>`, `zones`).
- `ArtifactRef`/`ArtifactStore`/`createArtifactStore` (Task 2) are used identically in Task 4 (registry), Task 6 (install). `slotPath`, `isMaterialized`, `materialize` signatures match.
- `SentinessLock` (Task 3) shape (`engine.version`, `checks[id].{version,path,integrity,tool}`) is produced by `installCommand` (Task 6) and consumed by `CheckRegistry.fromResolved` (Task 4) and the launcher peek (Task 7) — consistent.
- `CommandDeps.cacheRoot` (Task 6) is set by the engine entrypoint (Task 6) and consumed by `installCommand`.
- `CheckContext.binPaths` / `ExecFileOptions.binPaths` (Task 5) — both added; runner threading is a V2 concern (the runner wiring lands in V2's per-zone task) but the seam exists now.

**Known seams left for later phases (intentional, not gaps):**
- The **runner** does not yet pass `binPaths`/`repoRoot` per check — that is V2 (TV2.2/TV2.3). In V1, checks run via `install`/`doctor`/`check` with the existing single-root context; npm tools resolve because the check slot's `.bin` is added by the runner wiring task in V2. For the V1 dogfood (Task 8) the checks are `path`-linked workspace packages whose tools are present in the repo's own `node_modules`, so V1 is demonstrably green without the slot-bin threading. **Flag:** when wiring `check`/`doctor` in V1 to `fromResolved`, ensure they still pass a valid `CheckContext`; full slot-bin threading is verified in V2.
- `doctor` and `check` command bodies are updated minimally in Tasks 4/6 (Step "update callers"); their full v2 behavior (per-zone, host-tool ranges) is V2.

**Placeholder scan:** The only intentional "wrong" code is the `@is-tool-${id}` placeholder in Task 6 Step 4, immediately corrected in Step 5 with the real `EXTERNAL_TOOL_PACKAGES` wiring — this is a guided TDD step, not an unresolved placeholder. No `TODO`/`TBD` remain.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-15-sentiness-v2-phase-v1-global-spine.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**

# Sentiness v2 — Global install model + polyglot monorepo support

> **Status:** Approved design + implementation spec (2026-06-15). Supersedes the exploratory
> `docs/multi-language-spec.md`. This document is written to be implementable by agents task-by-task.
> It follows the task template of `CLAUDE.md §11` (ID, Depends/Blocks, Files, Public interface,
> Implementation notes, Acceptance criteria, Tests). **All non-negotiable rules in `CLAUDE.md §3`
> and conventions in `§6`/`§7` still apply** — no `any`, no global state, no `console.log`, no
> swallowed errors, SOLID, co-located tests, ≥85% line / 80% branch coverage.
>
> **This is a breaking change.** Sentiness v2 drops the `node_modules`-resolution model entirely.
> There is **no dual-mode** and **no migration path** for old configs other than running `init` again.
> The only known consumer (one internal app testing Sentiness) will be migrated by hand.

---

## 1. Context and locked decisions

Sentiness v1 (current `main`) is a CLI quality gate for AI agents. It resolves each check as an npm
package from **the target project's `node_modules`** (`packages/core/src/registry/registry.ts`,
`CheckRegistry.fromConfig` → `createRequire(cwd/package.json).resolve('@sentiness/check-<id>')`),
and each check shells out to an external tool found on `PATH` (the project's `node_modules/.bin`,
prepended by `NodeProcessRunner.execFile`). This forces Node + `node_modules` into every target repo
and pins tool versions via the project's lockfile.

v2 changes the **distribution model** while keeping the core and all checks in Node/TypeScript. The
following decisions are **locked** (resolved during the 2026-06-14/15 design discussion):

1. **Global install, like the Claude Code CLI.** `npm i -g @sentiness/cli` installs a thin launcher
   on `PATH`. The target project contains **only universal files**: `sentiness.config.json`,
   `sentiness.lock`, `.sentiness/baseline.json`, and the agent instruction files
   (`CLAUDE.md`/`SKILL.md`/…). **Zero `node_modules` in the target project.**
2. **Thin launcher + version-pinned engine.** The launcher resolves the pinned engine version from
   config/lock and fetches `@sentiness/core@<version>` into a **global cache**
   (`~/.sentiness/cache/`), then dispatches to it. Engine, checks, and npm tools are all the same
   kind of artifact: "a pinned package materialized into the cache." One resolution model.
3. **Tool resolution order = `override → host → fetch`.** For every external tool a check needs:
   (1) an explicit override in config wins; (2) otherwise, if the tool is already on the host
   `PATH`/toolchain, use it (and warn if its version is outside the check's supported range);
   (3) otherwise fetch it — **but Sentiness only fetches from npm**. Non-npm tools (clippy, semgrep,
   osv-scanner, go vet, …) are **detect-only**: Sentiness verifies them on the host and prints an
   install hint if missing; it **never** runs `rustup`/`pip`/`go install`. Per-ecosystem fetchers
   are a deliberately deferred opt-in.
4. **Polyglot monorepo via zoned config.** A central `checks` catalog pins each check's version
   exactly once per repo. A `zones[]` array places checks onto subdirectories. Omitting `zones`
   means a single root zone. Repo-level checks (e.g. `deps-diff`) live in a `"."` zone. **Discovery
   is hybrid**: `init` auto-detects ecosystems per subdir and writes the explicit config; at runtime
   only the explicit config is read (deterministic, reviewable, committed).
5. **Determinism via a committed `sentiness.lock`.** Config carries *intent* (ranges, zones); the
   lock carries *exact resolved versions + integrity* of engine, checks, and npm tools, plus the
   *detected* version of host tools (for drift warnings). `sentiness install` materializes the lock
   into the cache (the `npm ci` analog), cacheable in CI by the lock-file hash.
6. **Everything stays Node/TS.** No subprocess Check Protocol, no standalone binary rewrite in this
   spec.
7. **One cross-language proof: `check-clippy`** (detect-only). It proves the whole model end-to-end
   (zoned config + per-zone execution + a Node check wrapping a non-JS host tool + one unified JSON
   report) without pulling in Rust dependency/coverage analysis or auto-install.

---

## 2. Scope and non-goals

**In scope (this spec):**

- The global launcher package `@sentiness/cli`.
- Cache paths, artifact store, lock read/write, and `install` live in `@sentiness/core` (the engine).
  The launcher (`@sentiness/cli`) carries only a **minimal self-bootstrap** (npm-fetch the engine +
  spawn) and shares no package with core (it would be fetching core) — it duplicates ~15 lines of npm-fetch.
- Config schema **v2** (catalog + zones + engine pin) and the `sentiness.lock` schema/manager.
- `CheckRegistry` resolving from the cache (not the project's `node_modules`).
- Per-zone execution in the runner; an additive `CheckContext` change.
- npm-tool checks declaring their tool as a package dependency; `ProcessRunner` resolving tool
  binaries from the check's cache slot.
- `sentiness install` (materialize lock → cache) and `init`/`doctor` updated for v2.
- `check-clippy` (detect-only) + a minimal SDK `tools` descriptor.
- Dogfooding migration of this repo + `examples/` + docs + E2E.

**Explicit non-goals (deferred, design left open, do NOT build here):**

- Subprocess Check Protocol (checks authored in non-JS languages). `CLAUDE.md`/`multi-language-spec.md §8.2`.
- Standalone compiled binary (`§8.1`).
- Non-npm tool **fetchers** (rust/python/go). Detect-only is the contract for v2.
- Rust/Go/Python **deps-diff / coverage / metadata** readers. Only `package.json` metadata exists.
- TUI / multi-project observability (`§9`).
- Any backward-compatibility shim for v1 configs or the `node_modules` resolution model.

If a task seems to require building a non-goal, **stop and surface it** (see `CLAUDE.md §13`).

---

## 3. Glossary (v2 terms)

- **Launcher** — the thin global CLI (`@sentiness/cli`, bin `sentiness`). Resolves and dispatches;
  contains no check logic.
- **Engine** — `@sentiness/core`, the runner/reporter/baseline/registry. In v2 it is a *cached,
  version-pinned artifact* the launcher invokes; it no longer owns the global `bin`.
- **Catalog** — the top-level `checks` object in config: `checkId → { version | path, options }`.
  Pins each check (and transitively its npm tool) exactly once per repo.
- **Zone** — a subdirectory with its own set of checks, rooted at its `path`. The unit of polyglot
  placement.
- **Slot** — a materialized cache directory for one pinned artifact:
  `~/.sentiness/cache/<kind>/<id>/<version>/`.
- **Artifact** — a pinned, fetchable unit: the engine or a check package (both npm packages).
- **Host tool** — an external tool resolved on the host `PATH`/toolchain, never fetched by Sentiness
  (clippy, semgrep, osv-scanner, …).
- **npm tool** — an external tool that ships as an npm package and is declared as a dependency of its
  check (`@biomejs/biome`, `eslint`, `knip`, `jscpd`). Materialized into the check's slot.
- **Lock** — `sentiness.lock`, the committed file pinning exact resolved versions + integrity.

---

## 4. Architecture overview

```
GLOBAL  (installed once:  npm i -g @sentiness/cli)
  sentiness (launcher) ──▶ reads project sentiness.config.json + sentiness.lock
        │  minimal self-bootstrap: npm-fetch the engine slot if missing
        ▼
  ~/.sentiness/cache/
        engine/<ver>/                 @sentiness/core@<ver> + its node_modules
        checks/<id>/<ver>/            @sentiness/check-<id>@<ver> + node_modules (incl. npm tool)
        │  launcher spawns:  node <engine slot>/dist/cli/index.js <argv>
        ▼
  ENGINE  (the v1 core, now cached)
        config(v2) → resolve zones → registry(from cache) → runner(per-zone) → baseline → reporter
        each check runs rooted at its zone; npm tool resolved from the check's own slot/.bin;
        host tool resolved on PATH (detect-only)
        ▼
PROJECT  (zero node_modules)
  sentiness.config.json   intent: engine pin, checks catalog (versions), zones
  sentiness.lock          exact resolved versions + integrity (determinism)
  .sentiness/baseline.json
  CLAUDE.md / .claude/skills/sentiness/SKILL.md / …
```

**Package topology change** (see §7 for the task):

| Package | v1 role | v2 role |
|---|---|---|
| `@sentiness/cli` | — (new) | Thin launcher. Owns the `sentiness` bin. Self-contained: resolves the cache root + engine pin, npm-fetches the engine into the cache, spawns it with `--cache-root`. No dependency on `@sentiness/core`. |
| `@sentiness/core` | engine **and** bin | Engine only. Loses the `bin` field. Owns cache paths, artifact store, lock, and `install`. Exposes an engine entrypoint the launcher spawns. |
| `@sentiness/check-sdk` | SDK | SDK + additive `tools` descriptor + additive `CheckContext.repoRoot`. |
| `@sentiness/check-*` | check + tool on PATH | check; npm-tool checks declare their tool as a `dependency`. |

> The new package (`@sentiness/cli`) must be wired into the workspace release allowlists and the
> Changesets config (see the release pipeline) as part of TV1.5.

---

## 5. New and changed artifacts (exact contracts)

### 5.1 `sentiness.config.json` v2

Source of truth is a Zod schema in `packages/core/src/config/config.ts` (rewritten). Shape:

```ts
// schemaVersion is bumped to '2.0'. The v1 '1.0' shape is NOT accepted (no dual-mode).
type Tier = 'fast' | 'standard' | 'slow';

type CatalogCheckEntry = {
  // Exactly one of `version` or `path` must be present (validated):
  readonly version?: string;        // npm semver range/exact; resolved to exact in the lock
  readonly path?: string;           // local link (dev / workspace), relative to repo root; never fetched
  readonly tier?: Tier;             // overrides the check's defaultTier
  readonly toolVersion?: string;    // overrides the npm tool version the check bundles (passed at materialize)
  readonly thresholds?: Readonly<Record<string, number | string>>;
  readonly [key: string]: unknown;  // check-specific options (catchall)
};

type ZoneCheckOverride = {
  readonly id: string;              // must exist in the catalog
  readonly tier?: Tier;
  readonly thresholds?: Readonly<Record<string, number | string>>;
  readonly [key: string]: unknown;
};

type ZoneEntry = {
  readonly path: string;                                   // repo-relative; '.' = repo root
  readonly checks: ReadonlyArray<string | ZoneCheckOverride>;  // catalog ids, or {id + per-zone overrides}
};

type SentinessConfigV2 = {
  readonly schemaVersion: '2.0';
  readonly engine: string;                                  // engine pin: npm semver range/exact
  readonly checks: Readonly<Record<string, CatalogCheckEntry>>;  // the catalog
  readonly zones?: ReadonlyArray<ZoneEntry>;                // omit => single root zone with all catalog checks
  readonly tiers?: { readonly fast?: Partial<TierSettings>; readonly standard?: Partial<TierSettings>; readonly slow?: Partial<TierSettings> };
  readonly reporting?: { readonly compact?: boolean; readonly omitOk?: boolean; readonly warningsAreErrors?: boolean };
  readonly baseline?: { readonly path: string };
  readonly pending?: { readonly path: string };
  readonly agents?: ReadonlyArray<'claude-code' | 'claude-code-skill' | 'codex' | 'codex-skill' | 'gemini'>;
};
// TierSettings = { triggers: Trigger[]; timeoutMs: number } — unchanged from v1.
```

Validation rules (Zod `.superRefine`):

- `schemaVersion` must equal the literal `'2.0'`; any other value (including `'1.0'`) is a
  `ConfigParseError` whose message tells the user to run `sentiness init` to migrate.
- Each `CatalogCheckEntry` has **exactly one** of `version` / `path`.
- Every `ZoneEntry.checks` id (string or `.id`) must exist as a key in `checks`. Unknown id →
  `ConfigParseError` naming the zone and id.
- `zones[].path` must be unique. A `'.'` zone is allowed and conventional for repo-level checks.
- Tier trigger uniqueness across tiers is preserved from v1 (`validateNoDuplicateTriggers`).

`ResolvedConfig` (after defaults) keeps the v1 shape for `tiers`/`reporting`/`baseline`/`pending`/
`agents`, plus `engine: string`, `checks: Record<string, ResolvedCatalogCheckEntry>`, and
`zones: ReadonlyArray<ZoneEntry>` where an absent `zones` is normalized to
`[{ path: '.', checks: <all catalog ids> }]`.

### 5.2 `sentiness.lock`

Schema in `packages/core/src/lock/schema.ts`. Pretty-printed JSON, **keys sorted** for stable
diffs.

```ts
type LockTool = {
  readonly name: string;                  // '@biomejs/biome' | 'clippy' | …
  readonly ecosystem: 'npm' | 'host';
  readonly version?: string;              // npm: exact resolved; host: omitted
  readonly integrity?: string;            // npm only (sha512 from the install)
  readonly detectedVersion?: string;      // host: the version found at lock time (drift baseline)
  readonly supported?: string;            // host: the check's declared supported range
};

type LockCheck = {
  readonly version?: string;              // exact resolved npm version (absent when `path`-linked)
  readonly path?: string;                 // present when the catalog entry is `path`-linked
  readonly integrity?: string;            // npm only
  readonly tool?: LockTool;               // the external tool this check uses, if any
};

type SentinessLock = {
  readonly lockfileVersion: 1;
  readonly engine: { readonly version: string; readonly integrity?: string };
  readonly checks: Readonly<Record<string, LockCheck>>;  // keyed by check id
};
```

### 5.3 Global cache layout

```
~/.sentiness/                         (override root via SENTINESS_HOME; see config-loading module)
  cache/
    engine/<version>/                 npm-extracted @sentiness/core@<version> (+ node_modules)
    checks/<id>/<version>/            npm-extracted @sentiness/check-<id>@<version> (+ node_modules incl. npm tool)
  tmp/                                staging for atomic materialization (rename into place)
```

- Cache root is resolved by the **launcher** (`@sentiness/cli`) — the only place that reads
  `process.env.SENTINESS_HOME` / `os.homedir()` — and passed to the engine via `--cache-root`. The
  engine's `createCachePaths(root)` takes the root explicitly and reads no env (`CLAUDE.md §3.3`).
- A slot is "materialized" iff `<slot>/.sentiness-materialized` marker file exists (written last,
  after a successful extract, so a half-extracted slot is never considered ready).
- Materialization is atomic: install into `cache/tmp/<random>/`, then `FileSystem.rename` to the
  final slot. Concurrent materializations of the same slot: if the destination already exists after
  rename loses the race, discard the temp dir (idempotent).

### 5.4 Resolution algorithm

**Engine** (launcher side): read `config.engine` (range) + `lock.engine.version` (exact). If the
lock is present and its engine satisfies the config range, materialize that exact version. If the
lock is missing/stale, the launcher refuses to guess — it prints "run `sentiness install`" and exits
non-zero. (`install` is what resolves ranges → exact and writes the lock.)

**Check (npm-fetched)** — for a catalog entry with `version`:
1. `install` resolves the range to an exact version (`npm view @sentiness/check-<id>@<range> version`,
   pick the max satisfying), records `{ version, integrity }` in the lock, and materializes the slot
   (`npm install --prefix <slot> --no-save @sentiness/check-<id>@<exact>` and, when `toolVersion` is
   set, the tool is overridden by adding it explicitly: the check declares the tool as a normal
   dependency, so the slot's `node_modules` already contains the default; `toolVersion` triggers an
   extra `npm install --prefix <slot> --no-save <tool>@<toolVersion>`).
2. At run time the registry imports the check from the slot. No fetching at run time — a missing
   slot is a hard error telling the user to run `sentiness install`.

**Check (path-linked)** — for a catalog entry with `path`: the registry imports directly from
`<repoRoot>/<path>` (resolved to its `dist`/`exports`). No fetch, no lock version. This is the
**dogfooding / check-author / workspace** path (the analog of `npm link`). The lock records
`{ path }`.

**External tool, per check, at run time** (`override → host → fetch`):
1. **Override**: `checks.<id>.toolVersion` (npm) or an explicit tool path option → use it.
2. **Host**: run the check's `detect()` (which execs `<tool> --version`). If found, use it; if the
   detected version is outside the check's declared `supported` range, the result carries a
   `warning`-level platform note (does not fail the run).
3. **Fetch**: only for `ecosystem: 'npm'` tools — already materialized in the check's slot by
   `install`; the `ProcessRunner` PATH includes the slot's `.bin`. Non-npm tools are never fetched;
   absence → `detect()` returns `{ available: false }` → the check is `skipped` with a `doctor`-style
   hint.

---

## 6. Determinism contract (dev ↔ CI)

The committed pair (`sentiness.config.json` + `sentiness.lock`) fully determines what runs:

- `config` declares intent: engine range, which checks (catalog) at which version range, which zones.
- `lock` pins exact engine version, exact check versions + integrity, exact npm tool versions +
  integrity, and the detected host-tool versions (for drift warnings).
- `sentiness install` (CI: `sentiness install --frozen`) materializes exactly the lock into the
  cache. `--frozen` fails if the lock is missing or does not satisfy the config (the `npm ci`
  contract). CI caches `~/.sentiness/cache` keyed by the hash of `sentiness.lock`.
- Host tools (clippy, semgrep, …) are pinned by the **host toolchain** (`rust-toolchain.toml`,
  `mise`/`asdf`, devcontainer), not by Sentiness. The lock's `detectedVersion` + the check's
  `supported` range turn a host/CI mismatch into a visible `warning`, not a silent divergence.

---

## 7. Tasks

> Phases are sequential: **V1 → V2 → V3 → V4**. Within a phase, tasks marked *parallel-safe* touch
> disjoint files. Each task: open a branch `task/TV<id>-<slug>`; first commit updates
> `docs/progress.md` to mark it in-progress. Definition of Done = `CLAUDE.md §12` (all of it).

### Phase V1 — Global spine

> Goal: Sentiness runs from a global launcher against a project with **zero `node_modules`**, using
> the **existing JS checks** fetched into the cache. No zones yet (single root zone). This validates
> pillars 1, 2, 3, 5 before polyglot work.
>
> Note: the existing **non-npm-tool checks** (`osv-scanner` = Go, `semgrep` = Python) already work
> here under the `host` detect-only rule — their JS wrappers ship as cached checks like any other,
> their tools resolve on the host PATH with an install hint if missing. They already exercise the
> host-tool path; `check-clippy` (V3) only adds the *zone + non-JS-target* dimension on top.

#### TV1.1 — Config schema v2

**Depends on:** none (greenfield rewrite of the config module)
**Blocks:** TV1.4, TV1.6, TV2.1, TV2.4
**Parallel-safe with:** TV1.2, TV1.3

**Files:**
- `packages/core/src/config/config.ts` (rewrite schema + types to v2)
- `packages/core/src/config/config.test.ts`

**Public interface:**

```ts
export type SentinessConfigV2 = { /* §5.1 */ };
export type ResolvedConfig = { /* §5.1: engine, checks, zones (normalized), tiers, reporting, baseline, pending, agents */ };
export class ConfigParseError extends Error {}
export class ConfigNotFoundError extends Error {}
export function validateConfig(input: unknown): SentinessConfigV2;     // throws ConfigParseError
export function resolveConfig(config: SentinessConfigV2): ResolvedConfig;
export async function loadConfig(cwd: string, fs: FileSystem): Promise<ResolvedConfig>;
export const DEFAULT_CONFIG_V2: Pick<ResolvedConfig, 'tiers' | 'reporting' | 'baseline' | 'pending' | 'agents'>;
```

**Implementation notes:**
- Keep the v1 tier/reporting/baseline/pending/agents defaults and `validateNoDuplicateTriggers`.
- Add `engine` (required string) and the catalog/zone shapes from §5.1.
- `resolveConfig` normalizes an absent `zones` to a single `{ path: '.', checks: <all catalog ids> }`.
- `loadConfig` still tries `sentiness.config.js` then `.json` (same precedence as v1).
- A `schemaVersion` other than `'2.0'` throws `ConfigParseError('… run `sentiness init` to migrate to v2')`.

**Acceptance criteria:**
- [ ] Loads a v2 `.json` and `.js` config; rejects `schemaVersion: '1.0'` with a migration message.
- [ ] `exactly-one-of version|path` enforced; unknown zone check id rejected with zone+id in message.
- [ ] Absent `zones` normalizes to a single root zone containing every catalog id.
- [ ] Duplicate `zones[].path` rejected.

**Tests required:**
- [ ] Each error path (bad schemaVersion, both version+path, neither, unknown zone id, dup path, dup trigger).
- [ ] Root-zone normalization.
- [ ] Round-trip: valid config parses, resolves, re-serializes to equivalent semantics.

---

#### TV1.2 — Lock schema + manager

**Depends on:** TV1.1 (uses `ResolvedConfig`)
**Blocks:** TV1.4, TV1.6
**Parallel-safe with:** TV1.3

**Files:**
- `packages/core/src/lock/lock.ts`
- `packages/core/src/lock/lock.test.ts`
- `packages/core/src/lock/schema.ts`

**Public interface:**

```ts
export type SentinessLock = { /* §5.2 */ };
export class LockParseError extends Error {}
export class LockManager {
  static async load(path: string, fs: FileSystem): Promise<SentinessLock | undefined>;  // undefined if absent
  static async save(path: string, lock: SentinessLock, fs: FileSystem): Promise<void>;  // atomic; keys sorted
  static satisfies(lock: SentinessLock, config: ResolvedConfig): { ok: boolean; reasons: readonly string[] };
}
// LockManager lives in @sentiness/core, so it takes ResolvedConfig directly — no dependency cycle.
```

**Implementation notes:**
- `save` writes via temp-file + `FileSystem.rename` (atomic), `checks` keyed object sorted by id,
  JSON pretty-printed (2 spaces) so diffs are stable.
- `satisfies` checks: lock present; `lock.engine.version` satisfies `config.engine`; every catalog
  check has a lock entry whose `version` satisfies the catalog range (or whose `path` matches). Used
  by `install --frozen` and by the engine on start (the launcher only peeks `lock.engine.version`).
- Validate on load with Zod; malformed lock → `LockParseError` with the file path.

**Acceptance criteria:**
- [ ] Load → save → load is identity; saved JSON is sorted (snapshot test).
- [ ] `satisfies` returns actionable `reasons` for: missing lock, engine drift, missing/incompatible check.
- [ ] Malformed lock yields `LockParseError` with path.

**Tests required:**
- [ ] Round-trip with `InMemoryFileSystem`.
- [ ] `satisfies` matrix (ok / engine drift / missing check / range mismatch / path-linked match).

---

#### TV1.3 — Cache paths + artifact store

**Depends on:** none
**Blocks:** TV1.4, TV1.6
**Parallel-safe with:** TV1.1, TV1.2

**Files:**
- `packages/core/src/cache/paths.ts`
- `packages/core/src/cache/paths.test.ts`
- `packages/core/src/cache/artifact-store.ts`
- `packages/core/src/cache/artifact-store.test.ts`

**Public interface:**

```ts
export type ArtifactKind = 'engine' | 'check';
export interface ArtifactRef {
  readonly kind: ArtifactKind;
  readonly id: string;          // 'core' for engine; check id otherwise
  readonly version: string;     // exact
  readonly integrity?: string;  // verified when present
}
export interface CachePaths {
  readonly root: string;        // ~/.sentiness  (or $SENTINESS_HOME)
  slotPath(ref: ArtifactRef): string;
  tmpDir(): string;
}
export function createCachePaths(cacheRoot: string): CachePaths;  // root resolved by the launcher, passed via --cache-root

export interface MaterializeOptions {
  readonly packageName: string;        // '@sentiness/core' | '@sentiness/check-<id>'
  readonly extraInstalls?: readonly string[];  // e.g. ['@biomejs/biome@1.8.3'] for toolVersion override
  readonly signal?: AbortSignal;
}
export interface MaterializeResult { readonly path: string; readonly integrity: string }

export interface ArtifactStore {
  isMaterialized(ref: ArtifactRef): Promise<boolean>;
  materialize(ref: ArtifactRef, options: MaterializeOptions): Promise<MaterializeResult>;
  slotPath(ref: ArtifactRef): string;
}
export function createArtifactStore(deps: {
  readonly paths: CachePaths;
  readonly fs: FileSystem;
  readonly process: ProcessRunner;
  readonly logger: Logger;
}): ArtifactStore;
```

**Implementation notes:**
- `createCachePaths` takes the cache root as an argument (the launcher resolves it from `SENTINESS_HOME`/homedir and passes `--cache-root`); the engine reads no env here (`CLAUDE.md §3.3`).
- `isMaterialized` = existence of `<slot>/.sentiness-materialized`.
- `materialize`: create `tmpDir()/<rand>`, write a minimal `package.json` (`{ "private": true }`),
  run `process.execFile('npm', ['install', '--prefix', <tmp>, '--no-save', '--no-audit',
  '--no-fund', <packageName>@<version>, ...extraInstalls])`, read the installed package's resolved
  version + integrity from `<tmp>/node_modules/.package-lock.json`, write `.sentiness-materialized`,
  then `fs.rename(tmp, slot)`. If the slot already exists after losing a race, `fs.rm(tmp, recursive)`.
- Verify `integrity` against the ref when the ref provides one; mismatch throws (supply-chain guard).
- `npm` is the fetch mechanism (it does OIDC-free public resolution + integrity). Do **not** pull a
  programmatic npm client library (`CLAUDE.md §4` forbids extra heavy deps; shell out via
  `ProcessRunner`, matching the existing pattern).

**Acceptance criteria:**
- [ ] `slotPath` deterministic and OS-correct; honors `SENTINESS_HOME`.
- [ ] `materialize` is atomic (no half-slot ever marked materialized; verified by simulating a failed install).
- [ ] Integrity mismatch throws with a clear message.
- [ ] Re-materializing an existing slot is a no-op (idempotent).

**Tests required:**
- [ ] `FakeProcessRunner` scripting a successful `npm install`; assert exact argv and atomic rename via `InMemoryFileSystem`.
- [ ] Failed install path (non-zero exit) leaves no materialized marker.
- [ ] Race: two `materialize` calls for the same slot; one wins, both resolve to the slot.
- [ ] Integrity mismatch path.

---

#### TV1.4 — Registry from cache

**Depends on:** TV1.1, TV1.2, TV1.3
**Blocks:** TV1.5 (engine run path), TV2.2
**Parallel-safe with:** none in V1 (it consumes the above)

**Files:**
- `packages/core/src/registry/registry.ts` (rewrite `fromConfig`)
- `packages/core/src/registry/registry.test.ts`

**Public interface:**

```ts
export class CheckRegistry {
  static async fromResolved(
    config: ResolvedConfig,
    lock: SentinessLock,
    store: ArtifactStore,
    repoRoot: string,
  ): Promise<CheckRegistry>;
  list(): readonly Check[];
  get(id: CheckId): Check | undefined;
  filterByTier(tier: Tier): readonly Check[];
  loadFailures(): readonly CheckLoadFailure[];
}
export class CheckLoadError extends Error {}
export interface CheckLoadFailure { readonly requestedId: CheckId; readonly source: string; readonly message: string }
```

**Implementation notes:**
- For each catalog check id (validated against `^[a-z0-9][a-z0-9-]*$` as in v1):
  - If the catalog entry is `path`-linked → resolve `<repoRoot>/<path>` (via that package's
    `exports`/`dist/index.js`) and `import()` it.
  - Else → look up the lock entry for the exact version, compute `store.slotPath({kind:'check', id, version})`,
    `import()` `<slot>/node_modules/@sentiness/check-<id>/dist/index.js`. The slot **must** already be
    materialized (by `install`); if not, record a `CheckLoadFailure` with "run `sentiness install`".
  - Validate the default export implements `Check` (reuse the existing `validateCheck`).
- Honor per-check tier override (catalog `tier` and per-zone `ZoneCheckOverride.tier` — the zone
  override is applied by the runner/zone resolver, not here; the registry only knows catalog tier).
- Load failures never crash the registry (same as v1); surfaced as synthetic `platform` error results.

**Acceptance criteria:**
- [ ] Loads checks from cache slots (fixture slot dirs) and from `path`-linked local packages.
- [ ] Missing slot → `CheckLoadFailure` mentioning `sentiness install`, no crash.
- [ ] Invalid default export → `CheckLoadFailure`, no crash.

**Tests required:**
- [ ] Temp fixture slot with a valid check module → loaded.
- [ ] `path`-linked check (local fixture package) → loaded.
- [ ] Missing slot, invalid module → recorded failures, registry still lists the good ones.

---

#### TV1.5 — Thin launcher `@sentiness/cli`

**Depends on:** TV1.1 (engine-pin shape only)
**Blocks:** TV1.6 (shares CLI surface knowledge), TV4.* (E2E)
**Parallel-safe with:** TV1.2, TV1.3, TV1.4

**Files:**
- `packages/cli/package.json` (`bin: { sentiness: ./dist/index.js }`; **no** dependency on `@sentiness/core`)
- `packages/cli/tsconfig.json`
- `packages/cli/src/index.ts`
- `packages/cli/src/bootstrap.ts`     (self-contained: resolve cache root, fetch engine, spawn)
- `packages/cli/src/bootstrap.test.ts`
- `packages/cli/README.md`

**Public interface:**

```ts
export async function run(argv: readonly string[], deps: {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly fs: FileSystem;
  readonly process: ProcessRunner;
  readonly logger: Logger;
  readonly stdout: NodeJS.WritableStream;
  readonly stderr: NodeJS.WritableStream;
}): Promise<number>;  // returns the engine's exit code
```

**Implementation notes:**
- The launcher is **ultra-thin, self-contained, and ultra-stable** — it is not version-pinned per
  project and depends on **no** `@sentiness/core` (it would be fetching core). It carries its own
  ~15-line npm-fetch helper. It does only:
  1. Locate `sentiness.config.json|js` upward from `cwd`; if none → exit 3 with a clear message.
  2. Resolve the cache root (the **only** place reading `SENTINESS_HOME`/homedir).
  3. Read **only** the `engine` pin — a minimal inline JSON read of `config.engine`, **not** the full
     v2 config loader (that lives in the engine).
  4. Load `sentiness.lock` (minimal JSON peek of `lock.engine.version`); if absent → print
     "run `sentiness install`" and exit 3. The launcher does not resolve ranges or fully validate the
     lock — the engine does that on start.
  5. If the engine slot is missing, fetch it: `process.execFile('npm', ['install', '--prefix',
     <engineSlot>, '--no-save', '@sentiness/core@<lockedVersion>'])` (atomic via tmp + rename, same
     marker convention as the engine's artifact store).
  6. `process.execFile('node', [<engineSlot>/dist/cli/index.js, '--cache-root', <root>, ...argv],
     { cwd, env, stdio passthrough })` and return its exit code. **stdout is forwarded byte-for-byte**
     (the JSON report contract); logs stay on stderr.
- Dev bypass: `SENTINESS_ENGINE_PATH` (a local engine checkout) short-circuits steps 5–6 and spawns
  that path's CLI directly — the engine analog of `path`-linked checks. Keep minimal and documented.

**Acceptance criteria:**
- [ ] No config found → exit 3, helpful stderr, nothing on stdout.
- [ ] Lock missing/stale → exit 3 telling the user to run `sentiness install`.
- [ ] Engine present in cache → spawns it and forwards exit code + stdout verbatim.
- [ ] `bin` resolves as `sentiness` when installed.

**Tests required:**
- [ ] `FakeProcessRunner` + `InMemoryFileSystem`: no-config, stale-lock, happy spawn (assert exact node argv and that engine stdout is forwarded).
- [ ] Exit code is the engine's exit code.

---

#### TV1.6 — `sentiness install` + engine entrypoint wiring

**Depends on:** TV1.1, TV1.2, TV1.3, TV1.4
**Blocks:** TV4.* (E2E), TV2.4 (`init` calls `install`)
**Parallel-safe with:** TV1.5

**Files:**
- `packages/core/src/cli/commands/install.ts`
- `packages/core/src/cli/commands/install.test.ts`
- `packages/core/src/cli/commands/registry.ts` (register the command)
- `packages/core/src/cli/index.ts` (engine CLI entry — remove the `bin` reliance; this is the file the launcher spawns)
- `packages/core/package.json` (remove the `bin` field; keep `exports`)

**Public interface:**

```ts
// install.ts
export interface InstallOptions { readonly frozen: boolean; readonly signal?: AbortSignal }
export async function installCommand(options: InstallOptions, deps: CommandDeps): Promise<number>;
```

**Implementation notes:**
- `install` (non-frozen): load config; for each catalog check with `version`, resolve the range to an
  exact version via `process.execFile('npm', ['view', '@sentiness/check-<id>@<range>', 'version',
  '--json'])` (take the max satisfying); for the engine likewise. Write/refresh `sentiness.lock`
  with exact versions + integrity (integrity captured during `materialize`). For each check's tool:
  if `ecosystem: 'npm'`, the tool comes from the check's deps (record its resolved version/integrity
  by reading the slot's `.package-lock.json` after materialize); if `host`, run the check's `detect()`
  to record `detectedVersion` + the check's declared `supported` range.
- `install --frozen`: require an existing lock that `satisfies` the config; **do not** re-resolve.
  Materialize exactly the locked versions. Used in CI.
- Materialize the engine slot and every check slot.
- Removing the `bin` from `@sentiness/core`: the global `bin` now belongs solely to `@sentiness/cli`.
  `packages/core/src/cli/index.ts` remains the engine's argv entrypoint (spawned by the launcher);
  it must read its own stdout/stderr writers exactly as today (the `writeSync(process.stdout.fd, …)`
  fix from v1 is preserved).
- Host-tool detection needs the check loaded → `install` builds a registry (`CheckRegistry.fromResolved`)
  after materializing slots, then calls `detect()` per check to fill host-tool lock fields.
- The engine CLI (`packages/core/src/cli/index.ts`) accepts a hidden `--cache-root <path>` passed by
  the launcher; every engine command builds its `CachePaths`/`ArtifactStore` from it via
  `createCachePaths(root)`. `install` materializes the check slots (the engine slot itself was already
  materialized by the launcher).

**Acceptance criteria:**
- [ ] `install` writes a lock with exact engine + check + npm-tool versions and host-tool detected versions.
- [ ] `install --frozen` fails (exit 3) when the lock is missing or unsatisfied; succeeds materializing locked versions otherwise.
- [ ] `@sentiness/core` no longer declares a `bin`; the engine CLI still runs when invoked as `node …/cli/index.js`.

**Tests required:**
- [ ] `FakeProcessRunner` scripting `npm view` + `npm install` + `<tool> --version`; assert the written lock shape.
- [ ] `--frozen` failure and success paths.
- [ ] Engine stdout/stderr separation preserved (reuse v1 CLI tests).

---

#### TV1.7 — Checks declare npm tools; ProcessRunner resolves from the check slot

**Depends on:** TV1.3, TV1.4
**Blocks:** TV4.* (E2E)
**Parallel-safe with:** TV1.5, TV1.6 (touches check packages + the process runner, disjoint from CLI)

**Files:**
- `packages/checks/biome/package.json` (+ `eslint`, `knip`, `jscpd`: add the tool as a `dependency`)
- `packages/core/src/process/*` (the `NodeProcessRunner` PATH logic) + its test
- `packages/check-sdk/src/types.ts` (add `CheckContext.binPaths?: readonly string[]` — the check slot's `.bin` dirs)

**Implementation notes:**
- npm-tool checks add their tool to `dependencies` at an **exact** version (e.g. `check-biome` →
  `"@biomejs/biome": "1.8.3"`). This is what makes the tool deterministic once the check version is
  pinned. `toolVersion` in config overrides it at materialize time.
- The cached check runs with the tool resolvable: the engine, when invoking a check, must ensure the
  `ProcessRunner` PATH includes `<check slot>/node_modules/.bin`. Today `NodeProcessRunner.execFile`
  prepends `node_modules/.bin` from the `cwd` upward; v2 adds the **current check's slot bin** to the
  front. Mechanism: the runner passes the slot bin dir to the check's `CheckContext` (new optional
  field `binPaths?: readonly string[]`) and `NodeProcessRunner` prepends those first. Keep host-tool
  resolution working (system PATH still inherited) for non-npm tools.
- Non-npm checks (`osv-scanner`, `semgrep`, `clippy`) declare **no** tool dependency; they stay
  detect-only.

**Acceptance criteria:**
- [ ] `check-biome` (and eslint/knip/jscpd) depend on their tool at an exact version.
- [ ] A check run from a cache slot finds its npm tool via the slot's `.bin` even with a minimal PATH and no project `node_modules`.
- [ ] Host tools still resolve from the inherited system PATH.

**Tests required:**
- [ ] `process-runner` integration test: minimal PATH + a fake slot `.bin` → tool found.
- [ ] Each migrated check's package.json asserts the exact tool dep (a `release-packages`/lint check or unit assertion).

---

### Phase V2 — Zones (polyglot monorepo)

> Goal: one repo, multiple subdirectories, each with its own checks rooted at its path; one unified
> report. Exercised first with JS/TS multi-package zones (no non-JS yet).

#### TV2.1 — Zone model + resolver

**Depends on:** TV1.1
**Blocks:** TV2.2, TV2.4
**Parallel-safe with:** TV2.3

**Files:**
- `packages/core/src/zones/zones.ts`
- `packages/core/src/zones/zones.test.ts`

**Public interface:**

```ts
export interface ResolvedCheckPlacement {
  readonly id: CheckId;
  readonly tier: Tier;                       // catalog tier, overridden by zone override
  readonly options: Readonly<Record<string, unknown>>;  // merged catalog + zone overrides (thresholds etc.)
}
export interface ResolvedZone {
  readonly path: string;                     // repo-relative ('.' for root)
  readonly absRoot: string;                  // repoRoot joined with path
  readonly checks: readonly ResolvedCheckPlacement[];
}
export function resolveZones(config: ResolvedConfig, repoRoot: string): readonly ResolvedZone[];
```

**Implementation notes:**
- Pure function. Merges catalog entry options with per-zone `ZoneCheckOverride` (zone wins on
  `tier`/`thresholds`/specific keys; deep-merge per-check options).
- A check id may appear in multiple zones (e.g. `biome` in `apps/web` and `apps/admin`) — that is
  expected; the same catalog version applies (one version per repo, by design).
- `'.'` zone carries repo-level checks; `absRoot === repoRoot`.

**Acceptance criteria:**
- [ ] Single-root config (no `zones`) → one `ResolvedZone` at `'.'` with all catalog checks.
- [ ] Per-zone override merges over catalog defaults.
- [ ] Same check in two zones yields two placements with the same version/options-from-catalog.

**Tests required:**
- [ ] Root normalization, multi-zone, override merge, repeated-check-across-zones.

---

#### TV2.2 — Per-zone execution in the runner

**Depends on:** TV2.1, TV1.4, TV2.3
**Blocks:** TV4.* (E2E)
**Parallel-safe with:** none in V2

**Files:**
- `packages/core/src/runner/runner.ts` (extend to iterate zones)
- `packages/core/src/runner/runner.test.ts`
- `packages/core/src/reporter/reporter.ts` (carry `zone` onto each report `checks[]` entry)
- `packages/core/src/schema/report.ts` (additive optional `zone?: string` on each `checks[]` entry)
- `packages/core/src/reporter/reporter.test.ts`, `packages/core/src/schema/report.test.ts`

**Public interface (additions to `RunInput`/`RunOutcome`):**

```ts
// RunInput gains:
//   readonly zones: readonly ResolvedZone[];
//   readonly repoRoot: string;
// RunOutcome.results stays keyed by CheckId, but a check that runs in multiple zones is keyed by a
// composite id `${checkId}@${zonePath}` to avoid collisions; checkMetadata records { category, zonePath }.
export type ZonedCheckKey = string & { readonly __brand: 'ZonedCheckKey' };
```

**Implementation notes:**
- For each `ResolvedZone`, for each placement: build a per-zone `CheckContext` where
  `cwd = zone.absRoot`, `repoRoot = repoRoot` (new SDK field, TV2.3), and `changedFiles` is the repo
  changed-file list **filtered to files under `zone.path`** and **re-rooted to be zone-relative**.
- The check returns zone-relative `location.file`s; the runner **re-roots them back to repo-relative**
  (`join(zone.path, finding.location.file)`, normalized) before they enter the report, so the unified
  report's locations are always repo-relative. Fingerprints are computed by the check using the
  zone-relative path **plus** the check is unaffected — but baseline matching must be stable across
  runs: because the re-rooting is deterministic and the fingerprint input (`relativeFilePath`) is the
  path the check sees, document that **fingerprints are zone-relative**; the baseline stores them as
  the check produced them. (Do not double-root.)
- The reporter carries `zone` onto each report `checks[]` entry (additive optional `zone?: string`
  in `packages/core/src/schema/report.ts`, and its committed JSON-schema artifact regenerated);
  findings already hold repo-relative `location.file` from the re-rooting above.
- Concurrency: the existing `pLimit` now spans all (zone × check) pairs.
- Registry load failures and per-tier timeout behavior are unchanged; they apply per pair.

**Acceptance criteria:**
- [ ] A check runs once per zone it is placed in, rooted at the zone; results do not collide.
- [ ] `changedFiles` passed to a check are zone-relative and filtered to the zone subtree.
- [ ] Report `location.file` is repo-relative for every finding regardless of zone.
- [ ] Each report `checks[]` entry carries its `zone`; two zones running the same check produce two entries.
- [ ] Single-root config behaves exactly like v1 (one zone `'.'`).

**Tests required:**
- [ ] Two zones, two fake checks; assert per-zone `cwd`, filtered/re-rooted `changedFiles`, repo-relative output locations, no key collision.
- [ ] Single-root equivalence test.
- [ ] Concurrency limit respected across zone×check pairs.

---

#### TV2.3 — SDK: `CheckContext.repoRoot`

**Depends on:** the existing `@sentiness/check-sdk`
**Blocks:** TV2.2
**Parallel-safe with:** TV2.1

**Files:**
- `packages/check-sdk/src/types.ts` (add `readonly repoRoot: string;` to `CheckContext`; `binPaths` is owned by TV1.7)
- `packages/check-sdk/src/types.test.ts`

**Implementation notes:**
- Additive only (`CLAUDE.md` OCP). `cwd` remains the zone root; `repoRoot` is the monorepo root for
  the rare check that needs repo context. `binPaths` carries the check slot's `.bin` (TV1.7).
- Update the `_test-utils` `makeContext` default to set `repoRoot = cwd` so existing check tests pass
  unchanged.

**Acceptance criteria:**
- [ ] `repoRoot` present on `CheckContext`; `makeContext` defaults it to `cwd`.
- [ ] Existing check tests compile and pass without modification.

**Tests required:**
- [ ] `expectTypeOf` for the new fields.

---

#### TV2.4 — `init` v2: zone detection + write config/lock + warm cache

**Depends on:** TV1.1, TV1.6, TV2.1
**Blocks:** TV4.* (E2E)
**Parallel-safe with:** TV2.5

**Files:**
- `packages/core/src/cli/commands/init.ts` (orchestration)
- `packages/core/src/cli/commands/init-plan.ts` (extend detection to subdir ecosystems → zones)
- `packages/core/src/cli/commands/init-plan.test.ts`
- `packages/core/src/cli/commands/init-steps.ts` (replace `<pm> add -D` with write-config + `install`)
- `packages/core/src/cli/commands/init.test.ts`

**Public interface (extends the existing `buildOnboardingPlan`):**

```ts
export interface DetectedZone { readonly path: string; readonly ecosystem: 'node' | 'rust' | 'go' | 'unknown'; readonly recommendedCheckIds: readonly string[] }
export interface OnboardingPlanV2 {
  readonly engineVersion: string;            // the CLI's own version, pinned into config
  readonly zones: readonly DetectedZone[];   // [{ path: '.', … }] for single-project
  readonly catalog: readonly CheckRecommendation[];  // union of all zones' checks, deduped
  readonly detectedAgents: readonly string[];
}
export async function buildOnboardingPlanV2(cwd: string, fs: FileSystem): Promise<OnboardingPlanV2>;
```

**Implementation notes:**
- Detection walks the repo (bounded depth, ignore `node_modules`/`target`/`dist`/`.git`) for
  ecosystem markers: `package.json` → node zone; `Cargo.toml` → rust zone; `go.mod` → go zone. A
  single marker at root → single-project (no `zones` block written). Multiple markers in distinct
  subdirs → write `zones`.
- Per node zone, reuse the existing v1 detection (biome/eslint/coverage/etc.). Per rust zone,
  recommend `clippy` (the only non-JS check in v2). Go zone: recommend nothing yet (no go checks),
  but still record the zone so the structure is visible.
- **No `<pm> add -D` anymore.** `init` writes `sentiness.config.json` (catalog with version =
  the latest published version of each `@sentiness/check-<id>`, engine = the CLI's own version),
  formats it with the project formatter if present (keep the v1 issue-#2 fix), then runs
  `installCommand({ frozen: false })` to resolve + write the lock + warm the cache (with consent;
  `--yes` skips the prompt). Then offers `install-skill`, hooks, and baseline (unchanged order).
- Keep the non-interactive contract working: `init --yes --checks=biome --no-baseline` produces a
  single-root v2 config with only `biome`, resolves the lock, no baseline.

**Acceptance criteria:**
- [ ] Single-project repo → no `zones` block; multi-ecosystem monorepo → a `zones` array with detected paths.
- [ ] Generated config validates against the v2 schema and `install` produces a satisfying lock.
- [ ] No package-manager `add -D` is ever invoked; `install` warms the cache instead.
- [ ] `init --yes --checks=biome --no-baseline` still works (adapted assertions for v2 output).

**Tests required:**
- [ ] Detection branches (single node, node+rust monorepo, node+go) via `InMemoryFileSystem`.
- [ ] Generated config + lock validate; `FakeProcessRunner` asserts `install` ran (npm view/install), not `<pm> add -D`.

---

#### TV2.5 — `doctor` v2: per-zone, host-tool ranges

**Depends on:** TV2.1, TV1.4
**Blocks:** none
**Parallel-safe with:** TV2.4

**Files:**
- `packages/core/src/cli/commands/doctor.ts`
- `packages/core/src/cli/commands/doctor.test.ts`

**Implementation notes:**
- Resolve zones; for each zone × check, run `detect()` rooted at the zone and report availability.
- For host tools, compare the detected version against the check's declared `supported` range and
  report drift as a warning. For npm tools, report the materialized version from the slot.
- Still read-only (never runs a check). Reports a hint to run `sentiness install` if a slot is missing.

**Acceptance criteria:**
- [ ] Per-zone availability table; host-tool range drift surfaced as warning.
- [ ] Missing slot → install hint, no crash.

**Tests required:**
- [ ] Multi-zone doctor with a present and an absent tool; range-drift warning path.

---

### Phase V3 — Cross-language proof

#### TV3.1 — SDK `tools` descriptor

**Depends on:** existing SDK
**Blocks:** TV3.2, TV2.5 (host-range reporting)
**Parallel-safe with:** TV3.2's normalize work (different files)

**Files:**
- `packages/check-sdk/src/types.ts`
- `packages/check-sdk/src/types.test.ts`
- `packages/check-sdk/README.md` (document the descriptor)

**Public interface:**

```ts
export interface ToolRequirement {
  readonly name: string;                 // 'clippy' | '@biomejs/biome' | …
  readonly ecosystem: 'npm' | 'host';
  readonly supported?: string;           // semver range the check supports (host tools especially)
  readonly installHint?: string;         // e.g. 'rustup component add clippy'
}
// Additive optional field on Check:
export interface Check {
  // …existing…
  readonly tools?: readonly ToolRequirement[];
}
```

**Implementation notes:**
- Optional and additive (OCP). `doctor`/`install` use it for host-tool reporting and lock fields. npm
  tools are still ultimately pinned by the check's package dependency; the descriptor is metadata.

**Acceptance criteria:**
- [ ] `tools` is optional; existing checks compile unchanged.
- [ ] `expectTypeOf` covers the new shape.

**Tests required:**
- [ ] Type test + a doctor/install consumption test (may live in those tasks).

---

#### TV3.2 — `check-clippy` (the cross-language proof)

**Depends on:** TV3.1, TV1.7 (PATH/slot), TV2.3 (`repoRoot`)
**Blocks:** TV4.3 (cross-language E2E)
**Parallel-safe with:** other V3 work

**Files:**
- `packages/checks/clippy/package.json` (no tool dependency — host tool)
- `packages/checks/clippy/tsconfig.json`
- `packages/checks/clippy/src/index.ts`
- `packages/checks/clippy/src/clippy.ts`
- `packages/checks/clippy/src/clippy.test.ts`
- `packages/checks/clippy/src/normalize.ts`
- `packages/checks/clippy/src/normalize.test.ts`
- `packages/checks/clippy/README.md`

**Public interface:**

```ts
import type { Check } from '@sentiness/check-sdk';
const clippyCheck: Check = { /* id: 'clippy', category: 'lint', defaultTier: 'standard', tools: [{ name:'clippy', ecosystem:'host', supported:'>=1.75', installHint:'rustup component add clippy' }] */ };
export default clippyCheck;
```

**Implementation notes:**
- `detect`: `ctx.process.execFile('cargo', ['clippy', '--version'], { cwd, signal })` (the rustup shim
  respects the project's `rust-toolchain.toml`). Unavailable when exit ≠ 0 → `{ available: false,
  reason: 'cargo clippy not found — rustup component add clippy' }`.
- A zone with no `Cargo.toml` at its root → `run` returns `status: 'skipped'` with a clear reason
  (mirrors the playwright "config present" gate).
- `run`: `cargo clippy --message-format=json -- -D warnings` (configurable extra args via
  `ctx.checkConfig.extraArgs`). clippy emits a stream of JSON objects (one per line); parse the
  `compiler-message` entries. Exit non-zero **with** parseable messages is success-with-findings; any
  other failure with no parseable output is `status: 'error'`.
- Parse with a Zod schema covering the `reason: 'compiler-message'` envelope and `message` →
  `{ message, code: { code }, level ('warning'|'error'), spans: [{ file_name, line_start, column_start, line_end, column_end, is_primary }] }`. Use `.catchall(z.unknown())`.
- One `Finding` per primary span. `ruleId` = the clippy lint code (e.g. `clippy::needless_return`);
  `severity` = error/warning mapped from `level`; `location.file` is `spans[].file_name` (already
  zone-relative when run rooted at the zone — verify; otherwise make it zone-relative).
- Fingerprint via `computeFingerprint` with the span file as `relativeFilePath`, the source line read
  via `ctx.fs` (cache per file), `extraDiscriminator = ruleId`.
- Never auto-install clippy.

**Acceptance criteria:**
- [ ] `detect` reflects availability; missing `Cargo.toml` in the zone → graceful `skipped`.
- [ ] clippy warnings/errors map to findings with correct severity, zone-relative location, lint code as `ruleId`, 64-char fingerprint.
- [ ] Non-zero exit with valid JSON → `violations`; unparseable → `error`.

**Tests required:**
- [ ] `normalize` fixture with multiple compiler-messages, primary vs secondary spans, warning+error.
- [ ] `FakeProcessRunner` for `detect`, happy path, error path, skip-when-no-Cargo.toml.
- [ ] Property test: every finding has a 64-char fingerprint.

---

### Phase V4 — Dogfood, docs, E2E

#### TV4.1 — Migrate this repo + examples to v2

**Depends on:** TV1.*, TV2.*
**Blocks:** TV4.3
**Parallel-safe with:** TV4.2

**Files:**
- `sentiness.config.json` (this repo → v2: engine pin, catalog with `path`-linked workspace checks, single root zone)
- `examples/demo-project/sentiness.config.json` (→ v2)
- `examples/polyglot-demo/` (new: a `package.json` zone + a `crates/sample/` Rust zone with one
  intentional clippy lint, for the cross-language E2E)
- `docs/progress.md` (record the v2 migration)

**Implementation notes:**
- This repo dogfoods via `path`-linked catalog entries (workspace packages), so no npm fetch is
  needed for local development (the `path` resolution from TV1.4). The engine is `path`-linked via
  `SENTINESS_ENGINE_PATH` or an engine `path` pin documented in the launcher (TV1.5).
- The `polyglot-demo` Rust zone needs only a `Cargo.toml` + a `.rs` file with a lint clippy will flag
  (e.g. a `needless_return`). CI must have rust+clippy for the cross-language E2E, or that E2E is
  gated/skipped when clippy is absent (mirror the playwright "no real browser in CI" stance: the
  cross-language E2E may be skip-gated on clippy availability).

**Acceptance criteria:**
- [ ] This repo's `sentiness check` runs under v2 using `path`-linked checks, no project `node_modules` resolution.
- [ ] `examples/demo-project` runs under v2.
- [ ] `examples/polyglot-demo` exists with one node zone and one rust zone.

**Tests required:** covered by TV4.3.

---

#### TV4.2 — Docs

**Depends on:** TV1.*, TV2.*, TV3.*
**Blocks:** none
**Parallel-safe with:** TV4.1

**Files:**
- `docs/getting-started.md` (rewrite for global install + `install` + zones)
- `docs/config-reference.md` (new: full v2 config + lock reference, §5 of this spec, with examples)
- `docs/writing-a-check.md` (update: npm-tool-as-dependency, host-tool detect-only, `tools` descriptor, slot model)
- `README.md` (global model overview; remove `node_modules`-era language)
- `CLAUDE.md` (update §4/§5/§11 references to the v2 model; note the launcher/engine split). **Do not** quote the literal skill markers (the 2026-06-09 incident).

**Acceptance criteria:**
- [ ] Getting-started reflects `npm i -g @sentiness/cli` → `sentiness init` → `sentiness install` → `sentiness check`.
- [ ] Config reference documents catalog, zones, engine pin, lock, and the resolution order.

---

#### TV4.3 — E2E: global flow + cross-language

**Depends on:** TV1.*, TV2.*, TV3.2, TV4.1
**Blocks:** none
**Parallel-safe with:** none

**Files:**
- `packages/cli/test/e2e/global-flow.test.ts` (or `packages/core/test/e2e/…` if the harness prefers)

**Behavior:**
- Build the workspace; in a temp project with a v2 config (`path`-linked checks for hermeticity),
  run the launcher: `sentiness install` → assert lock written + cache slots materialized;
  `sentiness check --tier=fast` → assert the report JSON validates against `ReportSchema`, stdout is
  pure JSON, exit code matches.
- Zones: a temp monorepo with two node zones → assert findings carry repo-relative paths from both zones in one report.
- Cross-language (skip-gated on `cargo clippy` availability): run `check` against `examples/polyglot-demo`
  → assert a clippy finding and a biome finding appear in the **same** report, keyed by zone.
- `--frozen`: corrupt the lock → `sentiness install --frozen` exits non-zero.

**Acceptance criteria:**
- [ ] `install` → `check` round-trip green with zero project `node_modules`.
- [ ] Multi-zone report has repo-relative locations from each zone.
- [ ] Cross-language report unifies clippy + biome (when clippy present); otherwise the test skips that assertion with a logged reason.

---

## 8. Build order and parallelism

```
V1 (spine):   TV1.1 ─┬─ TV1.2 ─┐                      TV1.5 ── needs TV1.1 only (parallel)
              TV1.3 ─┴─────────┴─► TV1.4 ─┬─► TV1.6
                                          └─► TV1.7 (needs TV1.3 + TV1.4)
              (TV1.1‖TV1.3 parallel; TV1.2 after TV1.1; TV1.4 needs TV1.1+TV1.2+TV1.3)
V2 (zones):   TV2.3 ─┐
              TV2.1 ─┴─► TV2.2 ;  TV2.4 ;  TV2.5      (TV2.1‖TV2.3 ; TV2.4‖TV2.5)
V3 (proof):   TV3.1 ─► TV3.2
V4 (polish):  TV4.1 ‖ TV4.2  →  TV4.3
```

- **V1 is the critical path.** It is shippable on its own: global launcher running the existing JS
  checks against a `node_modules`-free single-project repo. Recommend landing V1 end-to-end (incl.
  TV4.1/TV4.3 scoped to single-zone) before starting V2.
- V2 adds zones; V3 adds the one non-JS check; V4 dogfoods/documents/proves.
- Parallel-safe within a phase: TV1.1‖TV1.2‖TV1.3 (until TV1.4 joins them); TV2.1‖TV2.3, TV2.4‖TV2.5;
  TV4.1‖TV4.2.

---

## 9. Risks and open questions

- **Launcher↔engine contract stability.** The launcher is not version-pinned per project, so its
  spawn contract (`node <engineSlot>/dist/cli/index.js <argv>`, stdout=report, stderr=logs, exit
  code) is frozen. Any future change must be backward compatible across engine versions. Treat
  `packages/cli/src/bootstrap.ts` as a stability-critical file.
- **`npm` as the fetch mechanism (accepted, not a dilemma).** Both the launcher (engine fetch) and
  the engine (`install`, check slots) shell out to `npm`, which is present whenever the launcher was
  installed via `npm i -g`. If `npm` is somehow absent, `install` fails with a clear message. (A
  future standalone binary would bundle a fetcher; out of scope.)
- **Fingerprint stability across the zone re-rooting (TV2.2).** Decided: fingerprints are
  **zone-relative** (the path the check sees). The runner re-roots only the *display* `location.file`
  to repo-relative. Baseline entries store the zone-relative fingerprint. This must be implemented
  exactly once and tested for idempotency, or adopted baselines will silently miss.
- **Host-tool determinism is delegated, not solved.** clippy/semgrep versions are pinned by the host
  toolchain; Sentiness only records + warns on drift (`detectedVersion` vs `supported`). This is the
  honest boundary chosen in design; it is a documented limitation, not a bug.
- **Cache GC.** Not in scope. Slots accumulate. A future `sentiness cache prune` is a deferred task;
  note it in `docs/progress.md` as a follow-up.
- **Open: should `zones[].checks` support a glob `path` (e.g. `packages/*`)?** Deferred — explicit
  paths only in v2. Revisit if monorepos with many uniform packages make the explicit list painful.

---

## 10. Definition of Done (per task)

Identical to `CLAUDE.md §12`. A task is done only when: all listed files exist; public interfaces
match exactly; all acceptance criteria checked; all required tests written and passing;
`pnpm --filter <pkg> typecheck|lint|test` green with coverage ≥85% line / 80% branch; no `any`, no
unsafe `as`, no `console.log`, no swallowed errors, no `// TODO` for required behavior; package
README present; `docs/progress.md` updated; PR references the task ID and lists any deviations with
justification.

---

## Appendix A — Full config v2 examples

**Single-project (no zones):**

```json
{
  "schemaVersion": "2.0",
  "engine": "2.0.0",
  "checks": {
    "biome": { "version": "2.0.0", "tier": "fast" },
    "knip": { "version": "2.0.0" },
    "coverage": { "version": "2.0.0", "thresholds": { "lineCoverage": 85, "diffLineCoverage": 90 } },
    "deps-diff": { "version": "2.0.0" }
  }
}
```

**Polyglot monorepo:**

```json
{
  "schemaVersion": "2.0",
  "engine": "2.0.0",
  "checks": {
    "biome": { "version": "2.0.0", "tier": "fast" },
    "knip": { "version": "2.0.0" },
    "coverage": { "version": "2.0.0" },
    "clippy": { "version": "2.0.0" },
    "deps-diff": { "version": "2.0.0" }
  },
  "zones": [
    { "path": "apps/web", "checks": ["biome", "knip", { "id": "coverage", "thresholds": { "lineCoverage": 80 } }] },
    { "path": "apps/admin", "checks": ["biome", "knip"] },
    { "path": "crates/engine", "checks": ["clippy"] },
    { "path": ".", "checks": ["deps-diff"] }
  ]
}
```

**Dogfooding (this repo, path-linked workspace checks):**

```json
{
  "schemaVersion": "2.0",
  "engine": "2.0.0",
  "checks": {
    "biome": { "path": "packages/checks/biome" },
    "knip": { "path": "packages/checks/knip" },
    "coverage": { "path": "packages/checks/coverage" },
    "deps-diff": { "path": "packages/checks/deps-diff" }
  }
}
```

## Appendix B — Launcher ↔ engine contract (frozen)

1. Launcher locates `sentiness.config.{js,json}` upward from `cwd`.
2. Launcher reads only the `engine` pin + the `lock`; if lock absent/unsatisfied → exit 3 with
   "run `sentiness install`".
3. Launcher materializes `engine/<version>` and spawns
   `node <slot>/dist/cli/index.js <original argv>` with inherited `cwd`/`env`.
4. The engine writes the **report JSON to stdout** and **logs to stderr**; the launcher forwards both
   byte-for-byte and returns the engine's exit code.
5. Exit codes are the engine's (`0/1/2` per report, `3` for Sentiness/runtime failure), unchanged
   from v1's `exitCodeFor`.

## Appendix C — Migration of the only existing consumer

The one internal app testing Sentiness migrates by: (1) `npm i -g @sentiness/cli`; (2) delete the
`@sentiness/*` devDependencies and any v1 `sentiness.config.json`; (3) run `sentiness init` to
generate the v2 config + lock; (4) `sentiness install`; (5) commit `sentiness.config.json` +
`sentiness.lock`. No dual-mode is provided.

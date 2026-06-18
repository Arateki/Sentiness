# @sentiness/core

## 1.0.1

### Patch Changes

- ff68c44: Add the internal `resolveZones` zone resolver (`packages/core/src/zones`), the
  foundation for Phase V2 per-zone execution. It maps a v2 config's `zones` into
  rooted, option-merged placements (`absRoot = join(repoRoot, path)`; catalog
  options deep-merged with per-zone overrides). No public API change — the module is
  internal to `core` and not re-exported from `index.ts`.
- Updated dependencies [ff68c44]
  - @sentiness/check-sdk@0.4.0
  - @sentiness/adapters@0.1.4

## 1.0.0

### Major Changes

- af725c0: Sentiness v2 global spine (Phase V1). The engine now runs against a project with
  no `node_modules`: config moves to schema v2 (catalog + zones + engine pin),
  `CheckRegistry` resolves each check from a `~/.sentiness/cache` slot or a local
  `path`-linked package, a committed `sentiness.lock` pins exact versions, and the
  new `sentiness install` command resolves ranges and warms the cache. npm-tool
  checks (biome, eslint, knip, jscpd) bundle their tool as an exact dependency, and
  the new thin `@sentiness/cli` launcher owns the global `sentiness` bin (removed
  from `@sentiness/core`), fetching the pinned engine into the cache and spawning it
  with `--cache-root`. `CheckContext`/`ExecFileOptions` gain an optional `binPaths`.

### Patch Changes

- 3f2747b: `sentiness init` now generates a v2 config instead of the removed schema 1.0
  shape: `schemaVersion: '2.0'`, an `engine` pin, and each enabled check written as
  a catalog entry (`{ version, tier }`). The legacy `<pm> add -D` step is gone —
  init resolves the catalog through `sentiness install` (with consent), which
  writes `sentiness.lock` and warms the cache. For polyglot monorepos, init detects
  per-directory ecosystems (`package.json` → node, `Cargo.toml` → rust, `go.mod` →
  go) and writes an explicit `zones[]` block; single-ecosystem projects omit it.
- Updated dependencies [af725c0]
  - @sentiness/check-sdk@0.3.0
  - @sentiness/adapters@0.1.3

## 0.1.4

### Patch Changes

- 8ff61b1: knip: suppress the Sentiness-stack false positives and scaffold a context-aware `knip.json` (#7)

  - `check-knip` now drops dependency findings for the `@sentiness/*` scope and the wrapped tool
    binaries at runtime (issue #7 option 1), and additionally declares `configFiles`,
    `configOptional`, and a dynamic `defaultConfig(ctx)` that scaffolds a minimal `knip.json` seeded
    with the enabled checks' tool binaries (option 2). Both ignore lists derive from one
    `CHECK_TOOL_DEPENDENCIES` map.
  - `@sentiness/check-sdk`: `defaultConfig` now receives a `DefaultConfigContext { enabledCheckIds }`,
    and a new additive `Check.configOptional` flag marks checks whose config file is optional. Existing
    `() => …` implementations remain assignable to the new signature (no breaking change).
  - `@sentiness/core`: `doctor` reports `config.optional` and no longer fails when an _optional_ config
    file is absent (a _required_ one still fails); `init-config` builds the `enabledCheckIds` context
    and passes it to `defaultConfig`.

- Updated dependencies [8ff61b1]
  - @sentiness/check-sdk@0.2.0
  - @sentiness/adapters@0.1.2

# @sentiness/cli

## 0.2.1

### Patch Changes

- Updated dependencies [ff68c44]
  - @sentiness/check-sdk@0.4.0

## 0.2.0

### Minor Changes

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

- Updated dependencies [af725c0]
  - @sentiness/check-sdk@0.3.0

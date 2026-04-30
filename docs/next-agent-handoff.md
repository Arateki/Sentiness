# Next Agent Handoff

Date: 2026-04-30

## Current Status

- Phase I is implemented: hunk/line-level `--diff` filtering and transitive deps-diff for npm
  lockfiles.
- All previous phases (A–H) remain done. The CLI is usable end-to-end: `pnpm sentiness doctor`,
  `pnpm sentiness check`, baseline workflows, background jobs, adapters, and 10 check packages.

## Phase I Notes

- `GitProvider` gained `changedLineRanges(cwd, baseRef)`. The Node-backed implementation parses
  `git diff --unified=0 --no-color --diff-filter=ACMRT` hunk headers; `parseChangedLineRanges` is
  exported from `packages/core/src/git/git.ts` and is unit-tested.
- `RunContext` and `CheckContext` now carry `changedRanges: ChangedLineRanges`. Runner only fetches
  ranges in `--diff` mode; otherwise the map is empty.
- `applyBaseline` takes the ranges as an optional fifth argument. A finding with a precise
  `location.startLine` is `introducedInDiff` only when that line falls inside a hunk; findings
  without a line (dependency, package, repository-level) keep falling back to file-level matching.
  In `--diff` mode, findings with a line outside the hunks are dropped.
- `@sentiness/check-deps-diff` now parses `package-lock.json` and `npm-shrinkwrap.json` (lockfile
  v3, hoisted versions only). When both base and current lockfiles parse, transitive findings are
  emitted at `info` severity with rule IDs `new-transitive-dependency`,
  `removed-transitive-dependency`, and `major-version-bump-transitive`. The check sets
  `metrics.transitiveDiffAvailable: true` only when transitive parsing succeeded.
- pnpm-lock.yaml and yarn.lock parsers are not implemented yet. Projects using only those lockfiles
  keep `transitiveDiffAvailable: false`, exactly as before.

## Validation Run

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm test:e2e
pnpm check:release-packages
pnpm sentiness check --tier=fast --compact
```

All gates pass on this commit. Core tests: 125 passing across 22 files. E2E: 13/13.
`check:release-packages` passes for 13 public packages.

## Recommended Next Step

1. Add a `pnpm-lock.yaml` parser to `@sentiness/check-deps-diff`. Two options: a tiny in-tree
   subset for the lockfile's well-known shape, or a single dependency on a small YAML library. Then
   add `yarn.lock` v1 and v2 parsers.
2. Decide whether dependency/package/repository-level findings should ever be filtered by `--diff`,
   or always pass through when the related file (lockfile, package.json) is in the changed set.

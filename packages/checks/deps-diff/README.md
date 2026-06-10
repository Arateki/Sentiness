# @sentiness/check-deps-diff

Compares direct dependency sections in the current `package.json` with the configured Git base ref
and reports added dependencies, removed dependencies, and major version bumps.

When a supported lockfile parses at both the base ref and the working tree, the check also diffs
transitive dependencies (`new-transitive-dependency`, `removed-transitive-dependency`,
`major-version-bump-transitive`, all `info` severity) and sets the metric
`transitiveDiffAvailable: true`. Supported lockfiles, tried in this order: `pnpm-lock.yaml`
(lockfile versions 5.x, 6.x, and 9.x), `package-lock.json` / `npm-shrinkwrap.json` (v2/v3), and
`yarn.lock` (classic v1 and berry). When no lockfile parses on both sides, the check still reports
direct changes and keeps `transitiveDiffAvailable: false`.

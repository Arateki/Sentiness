# @sentiness/check-deps-diff

Compares direct dependency sections in the current `package.json` with the configured Git base ref
and reports added dependencies, removed dependencies, and major version bumps.

This first slice intentionally does not parse transitive lockfile changes yet. It exposes the metric
`transitiveDiffAvailable: false` so future lockfile parsers can extend the same check without
changing the report contract.

# Next Agent Handoff

Date: 2026-04-30

## Current Status

- Phase H is implemented.
- New check packages: dependency-cruiser, deps-diff, lockfile-lint, osv-scanner, jscpd, and semgrep.
- The SDK `CheckContext` now exposes `git?: GitProvider`; the runner and doctor pass the provider so
  `deps-diff` can compare current `package.json` against a Git base ref.
- Root package wiring and `pnpm-lock.yaml` include the six new workspace packages.
- Release-package checks now include all public check packages.

## Phase H Notes

- `deps-diff` reports direct dependency additions, removals, and major-version bumps. It does not
  parse transitive lockfile changes yet and reports `transitiveDiffAvailable: false`.
- `dependency-cruiser`, `jscpd`, and `semgrep` emit `location.startLine` when their JSON reports
  include line data.
- `osv-scanner` and `lockfile-lint` are package/lockfile-level checks, so their findings point at
  lockfiles with package metadata when available.
- The init wizard knows all Phase H checks, but the heavier checks default to disabled in
  non-interactive init unless explicitly selected through `--checks=...`.

## Recommended Next Step

Proceed to Phase I: refine `--diff` from file-level filtering to hunk/line filtering. The Phase H
checks were written to provide line locations where available, which is the prerequisite recorded in
the previous handoff.

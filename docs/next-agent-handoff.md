# Next Agent Handoff

Date: 2026-04-29

## Current Status

- Working tree was clean when this handoff was written.
- Latest commit observed: `98073f8 feat: update implementation to derive SENTINESS_VERSION from package.json, enhance validation tests, and add public CLI examples`.
- Phase G is complete in `docs/progress.md`: E2E, public docs, generated report schema, CI, release-package checks, and public CLI example validation are in place.
- Phase H is not started. Missing checks are dependency-cruiser, osv-scanner, lockfile-lint, deps-diff, jscpd, and semgrep.

Recent validation passed before this handoff:

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm check:release-packages
pnpm sentiness check --tier=fast --compact
git diff --check
```

## Diff vs Phase H Decision

The `--diff` discussion was about improving how AI agents consume Sentiness output.

Current behavior:

- `sentiness check --diff --base=<ref>` runs at repo scope, computes changed files, and keeps findings whose `location.file` is in that changed-file set.
- This is file-level filtering. If a file changed, an old finding elsewhere in the same file may still appear as introduced in diff.
- This is not baseline-only. It helps both normal checks and baseline-filtered checks by reducing report noise for agents and PR review.

Possible future improvement:

- Parse Git hunks and keep only findings whose `location.startLine` overlaps changed lines.
- This would make `--diff` mean "findings on changed lines", not just "findings in changed files".
- It improves agent focus, but it is not required before adding more checks.

Recommended order:

- Proceed with Phase H first.
- While implementing Phase H checks, make every finding include `location.file` and include `location.startLine` whenever the tool can provide it.
- Refine `--diff` after Phase H, using those line locations to avoid broad file-level noise.

Reasoning:

- Phase H increases coverage and usefulness now.
- Current `--diff` is good enough as a first slice and is documented as file-level.
- Adding checks first does not compromise the system; precise line-level diff can be layered on later with less rework if new checks already emit good locations.


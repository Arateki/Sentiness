# Sentiness implementation handoff

Last updated: 2026-04-28

This document is a working handoff for continuing the implementation. The canonical product specification is still `CLAUDE.md`; this file records the practical phase approach, what has already landed, what is partial, and what should happen next.

## Implementation approach

The implementation should progress in usable slices, not by completing the whole specification before the CLI can run.

1. **Phase A - Usable vertical slice**
   - Goal: make Sentiness installable in the workspace, runnable from the CLI, and able to execute at least one real check end to end.
   - Definition of usable: `pnpm sentiness doctor` and `pnpm sentiness check --tier=fast --compact` work in this repository.
   - Status: **done**.

2. **Phase B - Baseline and diff productization**
   - Goal: turn the baseline APIs into real CLI workflows and make adoption of existing projects safe.
   - Scope: `sentiness baseline init/update/accept/prune`, stronger baseline validation, metric regression integration, and better diff semantics.
   - Status: **not started as CLI work**; core baseline primitives exist.

3. **Phase C - Agent feedback loop**
   - Goal: support long checks and pending feedback so AI agents can continue working without losing actionable results.
   - Scope: background job spawner, job status reader, pending feedback queue, lock handling, `sentiness status`, `sentiness pending`, and `sentiness check --background`.
   - Status: **partial**; `JobSpawner` is implemented.

4. **Phase D - CLI onboarding and local automation**
   - Goal: make Sentiness easy to add to a target repo.
   - Scope: `sentiness init`, `sentiness install-hooks`, richer `doctor`, config generation, hook generation, and package/tool detection.
   - Status: **partial**; `check` and a minimal `doctor` exist.

5. **Phase E - Check package expansion**
   - Goal: add the remaining check packages behind the same SDK contract.
   - Scope: dependency-cruiser, knip, coverage, stryker, osv-scanner, lockfile-lint, deps-diff, jscpd, semgrep.
   - Status: **partial**; only Biome exists.

6. **Phase F - Agent adapters**
   - Goal: generate managed instruction sections for Claude Code, Codex, and Gemini.
   - Scope: shared skill text template, adapter registry, managed marker updates, and `install-skill` integration.
   - Status: **not started**.

7. **Phase G - Integration, docs, and polish**
   - Goal: harden behavior across realistic projects and document public usage.
   - Scope: E2E tests against `examples/demo-project`, public README/docs, complete JSON schema artifact, CI examples, and release packaging.
   - Status: **not started**, except for the demo project scaffold.

## What is already implemented

### Repository and tooling

- pnpm workspace with root scripts: `build`, `test`, `lint`, `typecheck`, and `sentiness`.
- TypeScript strict workspace configuration.
- Biome lint/format configuration.
- Vitest base configuration.
- Root config file: `sentiness.config.json`.
- Lockfile generated and workspace dependencies linked.

### Naming and public surface

- Product name is now **Sentiness**.
- CLI command is `sentiness`.
- Runtime directory is `.sentiness/`.
- Config names are `sentiness.config.js` and `sentiness.config.json`.
- Package namespace is `@sentiness/*`.
- Report field is `sentinessVersion`.
- The only remaining use of the word "harness" is conceptual: `Test harness conventions` in the specification.

### `@sentiness/check-sdk`

- Public `Check` contract.
- Shared types for findings, severities, categories, tiers, filesystem, logger, process runner, git provider, and clock.
- Branded helpers for `CheckId` and `RuleId`.
- Severity comparison helpers.
- Fingerprint helper based on stable SHA-256 input.
- Unit/property tests for core SDK behavior.

### `@sentiness/_test-utils`

- `FakeProcessRunner`.
- `InMemoryFileSystem`.
- `InMemoryGit`.
- `SilentLogger`.
- Fixed clock helper.
- Tests for the main test doubles.

### `@sentiness/core`

- Config loader for `sentiness.config.js` and `sentiness.config.json`.
- Default tier config for `fast`, `standard`, and `slow`.
- Check registry that resolves enabled checks as `@sentiness/check-<id>`.
- Runner with tier resolution, trigger validation, timeouts, bounded concurrency, check detection, and check execution.
- Reporter that emits the normalized JSON report and agent instructions.
- Exit-code mapping for blocking reports.
- Baseline manager primitives: load, save, create from outcome, accept, and prune.
- Baseline application to suppress known fingerprints and optionally keep only changed-file findings.
- Logger abstraction and stream logger.
- Node filesystem implementation.
- Node process runner implementation.
- Git provider implementation.
- Package metadata detector.
- CLI commands:
  - `sentiness check`
  - `sentiness doctor`

### `@sentiness/check-biome`

- Biome check package.
- Tool availability detection through the injected process runner.
- Biome JSON normalization.
- Finding generation with SDK fingerprints.
- Tests for detection, run behavior, tool errors, normalization, and fingerprint shape.

### Example project

- `examples/demo-project` exists with a minimal source file and `sentiness.config.json`.

## Current validation status

The following commands passed after the Sentiness rename:

```sh
pnpm install
pnpm typecheck
pnpm build
pnpm test
pnpm lint
pnpm sentiness doctor
pnpm sentiness check --tier=fast --compact
```

The final `sentiness check` report returned `summary.status: "ok"` with no findings.

## Known gaps and incomplete areas

### CLI gaps

- `sentiness check` does not support `--background` yet.
- `sentiness status` is missing.
- `sentiness pending` and `sentiness pending ack` are missing.
- `sentiness baseline init/update/accept/prune` are missing.
- `sentiness init` is missing.
- `sentiness install-hooks` is missing.
- `sentiness install-skill` is missing.
- `doctor` currently lists registry load failures and registered checks, but it does not call each check's `detect()` yet.

### Baseline gaps

- Baseline saves are atomic (TODO).
- Deeper baseline JSON validation and property-based regression tests (TODO).

### Diff gaps

- `--diff` currently uses Git changed files and marks a finding as introduced when its file is changed.
- It does not yet compare exact diff hunks or prove that a specific finding was introduced by the current patch.
- This is usable for the first slice, but it is not the final precision expected by the spec.

### Report/schema gaps

- The Zod `ReportSchema` in `packages/core/src/schema/report.ts` is the real runtime schema today.
- `packages/core/schema/report.schema.json` is still a minimal placeholder and should be generated or expanded before treating it as public contract documentation.
- The schema should get regression tests that assert sample reports match the public JSON schema artifact.

### Check package gaps

Missing check packages:

- `@sentiness/check-dependency-cruiser`
- `@sentiness/check-knip`
- `@sentiness/check-coverage`
- `@sentiness/check-stryker`
- `@sentiness/check-osv-scanner`
- `@sentiness/check-lockfile-lint`
- `@sentiness/check-deps-diff`
- `@sentiness/check-jscpd`
- `@sentiness/check-semgrep`

### Adapter gaps

- No `packages/adapters` package exists yet.
- Shared skill template is missing.
- Claude Code, Codex, and Gemini managed-section writers are missing.
- Managed markers should use `<!-- sentiness:start -->` and `<!-- sentiness:end -->`.

### Test gaps

- No CLI integration tests yet.
- No E2E test suite yet.
- No tests around real package resolution from a fixture project.
- No tests for background jobs or pending feedback because those modules do not exist yet.
- No tests for generated agent instruction files.

## Recommended next steps

1. **Stabilize the current vertical slice**
   - Add CLI tests for `check` and `doctor`.
   - Expand or generate `packages/core/schema/report.schema.json`.
   - Add fixtures for config loading and registry load failures.
   - Keep all existing validation commands green.

2. **Implement baseline CLI workflows**
   - Add `sentiness baseline init`.
   - Add `sentiness baseline update`.
   - Add `sentiness baseline accept --fingerprint --reason`.
   - Add `sentiness baseline prune`.
   - Add atomic writes and deeper baseline validation.

3. **Upgrade `doctor` and onboarding**
   - Make `doctor` call `detect()` for each enabled check.
   - Add package/tool hints for missing checks.
   - Implement `sentiness init` after package metadata detection is exercised in tests.
   - Implement `sentiness install-hooks` after `check` and baseline flows are stable.

4. **Add background jobs and pending feedback**
   - Implement job storage under `.sentiness/jobs/<jobId>/`.
   - Implement pending feedback storage under `.sentiness/pending-feedback.json`.
   - Add lock handling for concurrent pending writes.
   - Wire `--background`, `status`, and `pending` commands.

5. **Add checks in risk-first order**
   - Recommended first: coverage, deps-diff, osv-scanner, lockfile-lint.
   - Then add architecture/dead-code checks: dependency-cruiser and knip.
   - Then add heavier signal checks: stryker, jscpd, semgrep.

6. **Add agent adapters**
   - Build the shared skill template first.
   - Then add Claude Code, Codex, and Gemini writers.
   - Wire `install-skill` only after adapters have tests around marker replacement.

7. **Finish integration and public docs**
   - Add E2E tests using `examples/demo-project`.
   - Add public README usage docs.
   - Add CI examples.
   - Confirm package export/bin behavior from a packed or linked install.

## How to resume safely

Before starting any next task:

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm lint
pnpm build
pnpm sentiness doctor
pnpm sentiness check --tier=fast --compact
```

When adding a new feature, keep the same vertical-slice rule: the feature is not done until it is wired through the CLI or a documented public API, covered by focused tests, and validated by the commands above.
nked install.

## How to resume safely

Before starting any next task:

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm lint
pnpm build
pnpm sentiness doctor
pnpm sentiness check --tier=fast --compact
```

When adding a new feature, keep the same vertical-slice rule: the feature is not done until it is wired through the CLI or a documented public API, covered by focused tests, and validated by the commands above.

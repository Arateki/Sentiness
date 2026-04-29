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
   - Status: **done**; CLI commands for `init`, `update`, `accept`, and `prune` are now available, generating a valid structured baseline JSON snapshot and applying diff constraints via `diff-filter`.

3. **Phase C - Agent feedback loop**
   - Goal: support long checks and pending feedback so AI agents can continue working without losing actionable results.
   - Scope: background job spawner, job status reader, pending feedback queue, lock handling, `sentiness status`, `sentiness pending`, and `sentiness check --background`.
   - Status: **done**; Background job execution, status reporting, and pending feedback queues are fully operational via the CLI.

4. **Phase D - CLI onboarding and local automation**
   - Goal: make Sentiness easy to add to a target repo.
   - Scope: `sentiness init`, `sentiness install-hooks`, richer `doctor`, config generation, hook generation, and package/tool detection.
   - Status: **partial**; `check`, `init`, and a minimal `doctor` exist.

5. **Phase E - Essential check packages**
   - Goal: add the most critical check packages to enable agent integration testing.
   - Scope: knip, coverage, and stryker (or just the minimal set requested for next steps).
   - Status: **done**; Biome, Knip, Coverage, and Stryker checks are implemented and integrated.

6. **Phase F - Agent adapters**
   - Goal: generate managed instruction sections for Claude Code, Codex, and Gemini.
   - Scope: shared skill text template, adapter registry, managed marker updates, and `install-skill` integration.
   - Status: **not started**.

7. **Phase G - Integration, docs, and polish**
   - Goal: harden behavior across realistic projects and document public usage.
   - Scope: E2E tests against `examples/demo-project`, public README/docs, complete JSON schema artifact, CI examples, and release packaging.
   - Status: **not started**, except for the demo project scaffold.

8. **Phase H - Additional check packages (Deferred)**
   - Goal: add the remaining heavier check packages.
   - Scope: dependency-cruiser, osv-scanner, lockfile-lint, deps-diff, jscpd, semgrep.
   - Status: **not started**.

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
- `packages/core/schema/report.schema.json` is now automatically generated from the Zod schema via a script.
- The schema should get regression tests that assert sample reports match the public JSON schema artifact.

### Check package gaps

Missing check packages (Phase H):

- `@sentiness/check-dependency-cruiser`
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

- No CLI integration tests yet (except for `init` and `spawner`).
- No E2E test suite yet.
- No tests for generated agent instruction files.

## Recommended next steps

1. **Finish CLI onboarding**
   - Implement `sentiness install-hooks`.
   - Upgrade `doctor` to call `detect()` for each enabled check.

2. **Agent Adapters (Phase F)**
   - Build the shared skill template.
   - Add Claude Code, Codex, and Gemini writers.
   - Wire `sentiness install-skill`.

3. **Dogfooding & Polish**
   - Add E2E tests using `examples/demo-project`.
   - Add public README usage docs.

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

# Sentiness implementation handoff

Last updated: 2026-04-29

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
   - Status: **done**; `init`, `install-hooks`, and `doctor` are implemented. `doctor` calls each enabled check's `detect()` and reports missing local tools with install suggestions.

5. **Phase E - Essential check packages**
   - Goal: add the most critical check packages to enable agent integration testing.
   - Scope: knip, coverage, and stryker (or just the minimal set requested for next steps).
   - Status: **done**; Biome, Knip, Coverage, and Stryker checks are implemented and integrated.

6. **Phase F - Agent adapters**
   - Goal: generate managed instruction sections for Claude Code, Codex, and Gemini.
   - Scope: shared skill text template, adapter registry, managed marker updates, and `install-skill` integration.
   - Status: **done**; `@sentiness/adapters` now provides the shared template, idempotent managed-section writers for `CLAUDE.md`, `AGENTS.md`, and `GEMINI.md`, and the CLI exposes `sentiness install-skill --agent=<claude-code|codex|gemini|all>`.

7. **Phase G - Integration, docs, and polish**
   - Goal: harden behavior across realistic projects and document public usage.
   - Scope: E2E tests against `examples/demo-project`, public README/docs, complete JSON schema artifact, CI examples, and release packaging.
   - Status: **partial**; T7.1 E2E full-flow tests now cover the built CLI against `examples/demo-project`, `doctor`, real Biome findings, background job status/result/pending feedback, baseline init suppression, direct hook installation, non-interactive `init`, `install-skill --agent=all`, and the committed report schema artifact. T7.2 public docs, CI examples, and release packaging remain.

8. **Phase H - Additional check packages (Deferred)**
   - Goal: add the remaining heavier check packages.
   - Scope: dependency-cruiser, osv-scanner, lockfile-lint, deps-diff, jscpd, semgrep.
   - Status: **not started**.

## Sprint corretivo (2026-04-28 / 2026-04-29)

A post-implementation audit identified a set of bugs and spec gaps that were addressed in a dedicated correction sprint. Two analysis documents were produced and committed:

- `docs/post-phase5-codex-review.md` — Codex's review and corrections (COD-1.1 through COD-1.6).
- `docs/post-phase5-claude-followup.md` — follow-up analysis by Claude verifying all 30 audit points, confirming 7 Codex-caught bugs missed in the original audit, and proposing 8 follow-up items (§4.1–§4.8).

### Corrections applied during the sprint (COD series)

| ID | What | Status |
|----|------|--------|
| COD-1.1 | Zod validation at all I/O boundaries (`JobMeta`, `BaselineSnapshot`, `PendingItem`, Istanbul report) | Done |
| COD-1.2 | `wrapWithPositionals()` added to registry to handle `cac` positional args | Done |
| COD-1.3 | `exitCodeFor()` returns 3 when `summary.status === 'error'` | Done |
| COD-1.4 | `compareMetrics` wired into `applyBaselineToOutcome`; metric regressions now surfaced in every run | Done |
| COD-1.5 | `metricSpecs` optional field added to `Check` interface and `RunOutcome.checkMetadata` | Done |
| COD-1.6 | `effectiveTier()` centralizes tier-from-trigger resolution in `check.ts` | Done |

### Follow-up fixes applied (§4 series)

| ID | What | Status |
|----|------|--------|
| §4.1 | `--trend` now has real semantics: `applyBaselineToOutcome` suppresses all findings when `mode === 'trend'`, leaving only metric regressions visible. `baselineApplied` is `false` in this mode. New test in `diff-filter.test.ts`. | **Done** |
| §4.5 | `'platform'` category is now documented in `CLAUDE.md` §T0.2 `Category` type and in Appendix A `checks[]` field. | **Done** |
| §4.2 | `SENTINESS_VERSION` is still hardcoded `'0.1.0'` in `packages/core/src/version.ts` | Open |
| §4.3 | No property-based tests for `applyBaseline` / `applyBaselineToOutcome` idempotency | Open |
| §4.4 | `install-hooks` command exists but is marked as a known gap above | **Done** |
| §4.6 | `doctor` does not yet call each check's `detect()` | **Done** |
| §4.7 | No E2E tests yet | **Done** |
| §4.8 | No adapter packages yet | **Done** |

---

## Phase F validation audit (2026-04-29)

Before starting Phase G, Phase F was rechecked against `CLAUDE.md` T6 and the recent post-Phase 5 correction history.

### Findings corrected

| ID | What | Status |
|----|------|--------|
| F-AUD-1 | The generated adapter template had all seven sections, but the hard-rules section summarized §3 too aggressively. It now carries the full adapted rule set, including no `any`, no unsafe casts, no global state, no `console.log`, no swallowed errors, no partial implementations, protected config/baseline/pending files, no disabled tests, and one task/branch/PR discipline. | Done |
| F-AUD-2 | Running adapter tests with coverage created `packages/adapters/coverage`, but the new package was missing from `.gitignore` and `biome.json` coverage exclusions. Both files now exclude adapter coverage output. | Done |
| F-AUD-3 | The adapter registry public surface was implemented but not directly asserted. `index.test.ts` now verifies `TEMPLATE_VERSION`, `listAdapters()`, `getAdapter()`, and the three target files. | Done |

### Validation performed

```sh
pnpm --filter @sentiness/adapters exec vitest run --config ../../vitest.config.base.ts src --coverage
pnpm typecheck
pnpm build
pnpm test
pnpm lint
pnpm sentiness check --tier=fast --compact
node packages/core/dist/cli/index.js install-skill --agent=all
node packages/core/dist/cli/index.js install-skill --agent=all
git check-ignore -v packages/adapters/coverage/coverage-final.json
```

Adapter package coverage after the audit: 97.72% lines and 84% branches. The built `install-skill --agent=all` smoke test created `CLAUDE.md`, `AGENTS.md`, and `GEMINI.md` in a temporary project on the first run and returned `changed: false` for all three on the second run.

---

## Phase G progress (2026-04-29)

### T7.1 E2E suite

Implemented `packages/core/test/e2e/full-flow.test.ts` and wired:

```sh
pnpm test:e2e
```

Coverage:

- Built CLI runs `check --tier=fast --compact` against `examples/demo-project`.
- `doctor` loads and detects the configured Biome check inside the demo project.
- A temporary copy of the demo project with a real Biome issue returns blocking findings and exit code `1`.
- Background flow completes end to end: `check --background` returns `jobId`, `status <jobId>` reaches `completed`, `result.json` validates against `ReportSchema`, `pending --all` contains the unacked feedback item, and `pending ack` marks it acknowledged.
- `baseline init` creates a structured baseline in a temporary Git project and subsequent `check` suppresses adopted findings.
- `install-hooks --push` writes managed pre-commit and pre-push hook blocks in a target Git repository.
- `init --yes --checks=biome --no-baseline` initializes a project through a deterministic non-interactive path.
- `install-skill --agent=all` creates Claude Code, Codex, and Gemini instruction files and is idempotent on re-run.
- The committed `packages/core/schema/report.schema.json` is non-empty and exposes useful top-level report contract properties.

The E2E suite found and fixed a real CLI process bug: JSON output could be lost when stdout was captured by another process. The CLI entrypoint now writes command stdout through `writeSync(process.stdout.fd, text)`, keeping command handlers unchanged while making subprocess capture deterministic.

Additional defects found and fixed while broadening T7.1:

- Baseline adoption could make later Biome checks fail on Sentiness runtime files such as `.sentiness/baseline.json`; the Biome check now ignores `.sentiness/` paths.
- `sentiness init` was hard to test safely because the wizard only had an interactive path; it now supports `--yes`, `--checks=<ids>`, and `--no-baseline`.
- The committed JSON schema artifact was effectively empty because the old `zod-to-json-schema` path did not produce a useful schema for the current Zod runtime. Schema generation now uses Zod's `toJSONSchema()` from the built runtime schema and formats the generated artifact with Biome.

---

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
- Baseline application: suppresses known fingerprints; in `diffOnly` mode drops out-of-diff findings; in `trend` mode suppresses all findings and surfaces only metric regressions.
- Metric regression detection wired into every run via `compareMetrics` inside `applyBaselineToOutcome`.
- Logger abstraction and stream logger.
- Node filesystem implementation.
- Node process runner implementation.
- Git provider implementation.
- Package metadata detector.
- Background job spawner, job status reader, and pending feedback queue.
- CLI commands:
  - `sentiness check` (including `--background`, `--diff`, `--trend`, `--base`)
  - `sentiness status`
  - `sentiness baseline init / update / accept / prune`
  - `sentiness pending` / `sentiness pending ack`
  - `sentiness install-hooks`
  - `sentiness install-skill`
  - `sentiness init` (wizard)
  - `sentiness doctor`

### `@sentiness/adapters`

- Shared generated instruction template for agent integrations.
- Public adapter registry: `listAdapters()`, `getAdapter()`, `renderSkill()`, and `TEMPLATE_VERSION`.
- Claude Code writer for root `CLAUDE.md`.
- Codex writer for root `AGENTS.md`.
- Gemini writer for root `GEMINI.md`.
- Idempotent replacement between `<!-- sentiness:start -->` and `<!-- sentiness:end -->` markers.

### Check packages

All implemented check packages follow the same structure: `detect`, `run`, `normalize`, fingerprint computation, and `FakeProcessRunner`-based tests.

- **`@sentiness/check-biome`** — Biome lint check; JSON normalization; severity and location mapping.
- **`@sentiness/check-knip`** — Unused exports and dead-dependency detection; JSON normalization.
- **`@sentiness/check-coverage`** — Istanbul `coverage-final.json` reader; per-file and diff coverage thresholds; skips gracefully when report is absent.
- **`@sentiness/check-stryker`** — StrykerJS mutation score; surviving-mutant findings; reads Stryker's JSON report.

### Example project

- `examples/demo-project` exists with a minimal source file and `sentiness.config.json`.

## Current validation status

The following commands passed after Phase G T7.1 broadening:

```sh
pnpm --filter @sentiness/core generate-schema
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm sentiness check --tier=fast --compact
```

`pnpm test:e2e` includes a full `pnpm build` before running the CLI E2E suite.

Additional CLI smoke validation:

```sh
node packages/core/dist/cli/index.js install-skill --agent=codex
node packages/core/dist/cli/index.js install-skill --agent=codex
```

The smoke test was run in a temporary project with `sentiness.config.json`; the first run wrote `AGENTS.md` and the second run returned `changed: false`, confirming idempotent managed-section replacement through the built CLI.

The final `sentiness check` report returned `summary.status: "ok"` with no findings. `pnpm sentiness doctor` currently exits `1` because this local checkout does not have the external `knip` and Stryker binaries installed; the command itself runs correctly and reports install suggestions.

## Known gaps and incomplete areas

### CLI gaps

- No known CLI command gap remains from the Phase D/F command list.

### Baseline gaps

- Baseline saves are atomic (TODO).
- Deeper baseline JSON validation and property-based regression tests (TODO).

### Diff gaps

- `--diff` currently uses Git changed files and marks a finding as introduced when its file is changed.
- It does not yet compare exact diff hunks or prove that a specific finding was introduced by the current patch.
- This is usable for the first slice, but it is not the final precision expected by the spec.

### Report/schema gaps

- The Zod `ReportSchema` in `packages/core/src/schema/report.ts` is the real runtime schema today.
- `packages/core/schema/report.schema.json` is now automatically generated from the built Zod schema via `z.toJSONSchema()` and formatted by the generation script.
- The schema should get deeper regression tests that validate sample reports with a real JSON Schema validator, not only the current E2E smoke check for a useful artifact shape.

### Check package gaps

Missing check packages (Phase H):

- `@sentiness/check-dependency-cruiser`
- `@sentiness/check-osv-scanner`
- `@sentiness/check-lockfile-lint`
- `@sentiness/check-deps-diff`
- `@sentiness/check-jscpd`
- `@sentiness/check-semgrep`

### Adapter gaps

- Adapter package, template, and three managed-section writers are implemented.
- E2E coverage for adapter installation exists through `install-skill --agent=all`.

### Test gaps

- E2E full-flow suite exists for `doctor`, `check`, blocking findings, background status/result/pending feedback/ack, baseline init suppression, `install-hooks`, non-interactive `init`, `install-skill`, and the generated report schema artifact.
- Remaining E2E gaps: deeper baseline workflows (`update`, `accept`, `prune`), hook idempotency/error cases, generated public docs examples after T7.2, CI examples, and release packaging.

## Recommended next steps

1. **T7.2 Documentation**
   - Add public README usage docs.
   - Add `docs/getting-started.md`, `docs/writing-a-check.md`, `docs/baseline-strategy.md`, and `docs/agent-skill.md`.

2. **Remaining T7 polish**
   - Add deeper E2E coverage for baseline `update`, `accept`, and `prune`.
   - Add public docs example validation, CI examples, and release packaging checks.

3. **Deferred check packages**
   - Implement dependency-cruiser, osv-scanner, lockfile-lint, deps-diff, jscpd, and semgrep when the core agent loop is covered by E2E.

## How to resume safely

Before starting any next task:

```sh
pnpm install
pnpm typecheck
pnpm build
pnpm test
pnpm test:e2e
pnpm lint
pnpm sentiness doctor
pnpm sentiness check --tier=fast --compact
```

When adding a new feature, keep the same vertical-slice rule: the feature is not done until it is wired through the CLI or a documented public API, covered by focused tests, and validated by the commands above.

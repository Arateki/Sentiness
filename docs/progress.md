# Sentiness implementation handoff

Last updated: 2026-06-09

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
   - Status: **done**; T7.1 E2E full-flow tests now cover the built CLI against `examples/demo-project`, `doctor`, real Biome findings, background job status/result/pending feedback, baseline init suppression, baseline `accept`/`prune`, metric baseline `update`, direct hook installation/idempotency/error handling, non-interactive `init`, `install-skill --agent=all`, and the committed report schema artifact. T7.2 public README/docs are in place, CI and release-package gates are wired, and public CLI examples are validated against the registered command surface.

8. **Phase H - Additional check packages**
   - Goal: add the remaining heavier check packages.
   - Scope: dependency-cruiser, osv-scanner, lockfile-lint, deps-diff, jscpd, semgrep.
   - Status: **done**; all six packages now expose public workspace packages, config schemas,
     normalization tests, process-runner tests, release allowlists, and workspace wiring.

9. **Phase I - Diff precision and transitive deps-diff**
   - Goal: tighten `--diff` from changed-file filtering to changed-line filtering and emit transitive
     dependency findings when a supported lockfile is present.
   - Scope: `GitProvider.changedLineRanges`, runner-level hunk propagation, hunk-aware
     `applyBaseline`, `package-lock.json` parser, and transitive findings in `@sentiness/check-deps-diff`.
   - Status: **done**; `--diff` now compares findings against changed line ranges parsed from
     `git diff --unified=0`, falling back to file-level matching when a finding has no line. The
     `deps-diff` check now flips `transitiveDiffAvailable: true` and surfaces `info`-severity
     `new-transitive-dependency`, `removed-transitive-dependency`, and
     `major-version-bump-transitive` findings whenever both base and current
     `package-lock.json`/`npm-shrinkwrap.json` files parse successfully. (Update 2026-06-10:
     `pnpm-lock.yaml` v5/v6/v9 and `yarn.lock` classic/berry parsers landed too — see the check
     package gaps section.)

10. **Phase J - Tool-config validation and bootstrap**
    - Goal: surface missing tool-level config files (e.g. `stryker.conf.json`) in `doctor` and
      let users generate sensible defaults from the CLI.
    - Scope: extend the `Check` SDK with `configFiles` and `defaultConfig`, update `doctor` to
      validate them, and add `sentiness init-config [--check=<id>] [--force]`.
    - Status: **done**; Stryker now ships a Biome-clean default template (`command` test runner with
      `pnpm test`, mutate globs covering both single-package and `packages/*` monorepos), `doctor`
      exits non-zero when an enabled check's config file is missing, and `init-config` writes the
      template idempotently. Knip's v6 per-file `issues[]` shape is now correctly normalized; a
      project-level `knip.json` documents dynamic-import workspaces (`@sentiness/check-*`) and
      demo-project entrypoints. `pending` and `init-config` are also now covered by unit tests.

11. **Phase K - Claude Code discoverable skill adapter**
    - Goal: install the agent instructions as a Claude Code skill (`.claude/skills/sentiness/SKILL.md`)
      so they load on demand instead of occupying every session's context via `CLAUDE.md`.
    - Scope: new `claude-code-skill` agent in `@sentiness/adapters` (`claudeCodeSkillAdapter`),
      `AgentName` extended, `AgentAdapter.targetFile` relaxed to `string`, `install-skill` CLI and
      E2E updated to cover the fourth adapter.
    - Status: **done** (committed 2026-06-09). The adapter writes a whole-file skill with YAML
      frontmatter (no managed markers), is idempotent, and `install-skill --agent=all` now returns
      four results. The generated `.claude/skills/sentiness/SKILL.md` is committed in this repo as
      dogfooding. All gates pass: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`
      (13/13).
    - Follow-up resolved 2026-06-09: `config.agents` now accepts `'claude-code-skill'`, with unit
      coverage in `config.test.ts` and an `install-skill --agent=all` filter test. The init wizard
      never prompts for agents (it points users at `install-skill`), so no wizard change was needed.

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
| §4.2 | `SENTINESS_VERSION` is now derived from `packages/core/package.json` at runtime and covered by `version.test.ts`, avoiding a duplicated release literal. | **Done** |
| §4.3 | Property-based tests now verify `applyBaseline` and `applyBaselineToOutcome` idempotency across random finding/baseline/diff combinations. | **Done** |
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
- `baseline accept` adds a current Biome finding fingerprint with an explicit reason, later `check` suppresses that fingerprint, and `baseline prune` removes it after the source finding is fixed.
- `baseline update --metric=coverage.lineCoverage` ratchets a real Coverage metric from a controlled Istanbul `coverage-final.json` report.
- `install-hooks --push` writes managed pre-commit and pre-push hook blocks in a target Git repository.
- Re-running `install-hooks --push` keeps managed direct hooks idempotent and preserves a single backup of an existing unmanaged hook.
- `install-hooks` outside a Git repository exits non-zero without writing hook files.
- `init --yes --checks=biome --no-baseline` initializes a project through a deterministic non-interactive path.
- `install-skill --agent=all` creates Claude Code, Codex, and Gemini instruction files and is idempotent on re-run.
- The committed `packages/core/schema/report.schema.json` is non-empty and exposes useful top-level report contract properties.

The E2E suite found and fixed a real CLI process bug: JSON output could be lost when stdout was captured by another process. The CLI entrypoint now writes command stdout through `writeSync(process.stdout.fd, text)`, keeping command handlers unchanged while making subprocess capture deterministic.

Additional defects found and fixed while broadening T7.1:

- Baseline adoption could make later Biome checks fail on Sentiness runtime files such as `.sentiness/baseline.json`; the Biome check now ignores `.sentiness/` paths.
- `sentiness init` was hard to test safely because the wizard only had an interactive path; it now supports `--yes`, `--checks=<ids>`, and `--no-baseline`.
- The committed JSON schema artifact was effectively empty because the old `zod-to-json-schema` path did not produce a useful schema for the current Zod runtime. Schema generation now uses Zod's `toJSONSchema()` from the built runtime schema and formats the generated artifact with Biome.

### T7.2 public documentation

Added the public documentation surface from `CLAUDE.md` Phase 7:

- `README.md` - project overview, current implementation status, quick start, CLI command map, config example, report contract, and local development gates.
- `docs/getting-started.md` - local checkout workflow, target-project initialization, daily check commands, background jobs, hooks, agent instructions, exit codes, and troubleshooting.
- `docs/writing-a-check.md` - check package discovery, minimal `Check` implementation, normalization/fingerprint responsibilities, metrics, and test expectations.
- `docs/baseline-strategy.md` - baseline file policy, initial adoption, diff/trend behavior, accepting findings, metric ratcheting, pruning, fingerprint discipline, and review rules.
- `docs/agent-skill.md` - supported agents, managed marker behavior, installed instruction contents, recommended agent workflow, reinstall triggers, and troubleshooting.

The docs intentionally do not claim release packaging is complete. They distinguish this checkout's `pnpm sentiness ...` workflow from target projects where a `sentiness` binary is already available.

### Baseline E2E polish

The E2E full-flow suite now includes the remaining baseline CLI workflows:

- `baseline accept` is exercised against a real Biome finding from the built CLI.
- The accepted fingerprint is verified as absent from a later report and counted in baseline suppression.
- `baseline prune` is verified after the source finding is fixed, preserving unrelated existing baseline entries.
- `baseline update --metric=coverage.lineCoverage` is exercised against a controlled Coverage check project and verifies metric ratcheting from `50` to `100`.

This required extending the E2E fixture helpers to link additional check packages and generate a minimal Istanbul `coverage-final.json`.

### Hook E2E polish

The E2E full-flow suite now includes direct hook edge cases:

- An existing unmanaged `.git/hooks/pre-commit` is backed up once to `.bak`.
- A second `install-hooks --push` run leaves managed pre-commit and pre-push hooks byte-for-byte unchanged.
- Managed blocks are not duplicated across repeated direct-hook installations.
- `install-hooks` outside a Git repository exits with code `1` and does not create hook files.

### CI and release packaging

Added a real GitHub Actions workflow at `.github/workflows/ci.yml` covering:

- `pnpm install --frozen-lockfile`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:e2e`
- `pnpm check:release-packages`
- `pnpm sentiness check --tier=fast --compact`

Release packaging is now guarded by `pnpm check:release-packages`, which rebuilds the workspace and validates the public package release allowlists for `@sentiness/check-sdk`, `@sentiness/adapters`, `@sentiness/core`, and the implemented check packages.

Packaging fixes applied:

- Public package `exports.types` now point at `./dist/index.d.ts` instead of source TypeScript.
- Public packages declare `files` allowlists so source, tests, and coverage artifacts are not packed.
- Check package builds clean `dist` before compiling, avoiding stale test artifacts.
- Missing package READMEs were added for `@sentiness/core`, `@sentiness/check-coverage`, `@sentiness/check-knip`, and `@sentiness/check-stryker`.

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
- **`@sentiness/check-deps-diff`** — Compares direct `package.json` dependencies against a Git base ref and reports added, removed, and major-version changes.
- **`@sentiness/check-dependency-cruiser`** — Runs dependency-cruiser JSON output and reports architecture rule violations against the importing file.
- **`@sentiness/check-lockfile-lint`** — Runs lockfile-lint for npm/Yarn lockfiles and reports lockfile policy violations.
- **`@sentiness/check-osv-scanner`** — Runs OSV Scanner against supported JavaScript lockfiles and reports vulnerable packages with upgrade suggestions.
- **`@sentiness/check-jscpd`** — Runs jscpd JSON reporting and surfaces duplicated code blocks with line locations.
- **`@sentiness/check-semgrep`** — Runs Semgrep JSON reporting with configurable rulesets and maps matches to security findings.

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

After T7.2 public docs, the following commands were rerun successfully:

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm sentiness check --tier=fast --compact
git diff --check
```

After baseline and hook E2E polish, the following commands passed:

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm sentiness check --tier=fast --compact
git diff --check
```

`pnpm test:e2e` now passes with 13 tests.

After Phase G CI/release packaging, `pnpm check:release-packages` passed for 7 public packages.

`pnpm test:e2e` includes a full `pnpm build` before running the CLI E2E suite.

After Phase H, the following commands passed:

```sh
pnpm install --ignore-scripts --offline
pnpm typecheck
pnpm test
pnpm lint
pnpm build
pnpm check:release-packages
pnpm test:e2e
pnpm sentiness check --tier=fast --compact
git diff --check
```

`pnpm check:release-packages` now validates 13 public packages.

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

- Baseline saves are atomic via temp-file write plus rename.
- Baseline JSON loading is validated with Zod; property-based regression coverage now exists for baseline/diff filtering idempotency.

### Diff gaps

- `--diff` now uses changed line ranges parsed from `git diff --unified=0`. A finding with a precise
  `location.startLine` is treated as introduced only when that line falls inside a hunk; findings
  without a line (for example dependency findings) keep falling back to file-level matching.
- Policy decided 2026-06-10: checks with category `security` or `platform` are exempt from the
  diff-mode drop. Their findings are always reported (with `introducedInDiff: false` when outside
  the diff), because new advisories appear without the code changing and platform results signal
  Sentiness's own failures. The baseline, not the diff filter, accepts known findings in these
  categories. Implemented in `applyBaselineToOutcome` via `RunOutcome.checkMetadata`;
  `applyBaseline` stays category-agnostic.
- This still does not prove a particular finding was *caused* by the current patch (a hunk may
  surface a pre-existing latent issue), but it is the spec's intended precision for `--diff`.

### Report/schema gaps

- The Zod `ReportSchema` in `packages/core/src/schema/report.ts` is the real runtime schema today.
- `packages/core/schema/report.schema.json` is now automatically generated from the built Zod schema via `z.toJSONSchema()` and formatted by the generation script.
- The committed schema artifact now has regression tests that validate representative reports and negative cases against the generated JSON Schema shape without adding a network-fetched validator dependency.

### Check package gaps

- `deps-diff` parses `pnpm-lock.yaml` (lockfile versions 5.x/6.x/9.x, line-based in-tree parser,
  no YAML dependency), `package-lock.json` / `npm-shrinkwrap.json`, and `yarn.lock` (classic v1
  and berry). `metrics.transitiveDiffAvailable` is `true` whenever both base and current lockfiles
  parse; candidates are tried in the T1.7 detection order (pnpm → npm → yarn). Lockfiles with no
  dependencies (no `packages:` section / no version blocks) parse as `undefined` and fall through
  to the next candidate.
- `lockfile-lint` skips pnpm-only projects because lockfile-lint does not support `pnpm-lock.yaml`.
- External-tool checks rely on the target project having the corresponding CLI installed; `doctor`
  reports missing tools and install guidance.

### Adapter gaps

- Adapter package, template, and three managed-section writers are implemented.
- E2E coverage for adapter installation exists through `install-skill --agent=all`.

### Test gaps

- E2E full-flow suite exists for `doctor`, `check`, blocking findings, background status/result/pending feedback/ack, baseline init suppression, baseline `update`/`accept`/`prune`, `install-hooks` including direct-hook idempotency/error cases, non-interactive `init`, `install-skill`, and the generated report schema artifact.
- Unit/property coverage now includes runtime package-version derivation, baseline/diff idempotency, deeper public report-schema artifact validation, and public docs CLI example validation.

## Local binary resolution (2026-06-10)

`NodeProcessRunner.execFile` now prepends every `node_modules/.bin` directory from the execution
`cwd` upward to the child process PATH, mirroring how npm/pnpm resolve binaries for scripts.
Previously, invoking the CLI directly (`node packages/core/dist/cli/index.js check --tier=fast`)
skipped external-tool checks with `spawn <tool> ENOENT` even when the tool was installed in the
project, because only package-manager scripts injected `.bin` into PATH. All checks are fixed at
once — none of them needed changes. Caller-provided `env` entries still apply on top of the
inherited environment. Covered by new `process-runner.test.ts` integration tests and verified by
running the built CLI with a minimal PATH (Biome went from `skipped`/ENOENT to actually running).

## Tool-config coverage extension (2026-06-10)

The Phase J `configFiles` + `defaultConfig` pattern was extended:

- `dependency-cruiser` now declares `configFiles`
  (`.dependency-cruiser.cjs`/`.js`/`.mjs`/`.json`, the tool's own lookup order) and a
  `defaultConfig` template (`.dependency-cruiser.cjs` with `no-circular` error and `no-orphans`
  warn rules), so `doctor` flags the gap and `init-config` can bootstrap it.
- **Decision:** `jscpd` and `semgrep` deliberately do **not** declare `configFiles`. jscpd runs
  fine with built-in defaults, and the semgrep check passes its ruleset via `--config=p/javascript`
  (overridable in check config) rather than a project file. Declaring config files for them would
  make `doctor` demand files the tools do not need.
- E2E coverage added: `doctor` reports `config: { configured: false, canCreateDefault: true }` plus
  a `configSuggestion`, `init-config --check=dependency-cruiser` writes the template, a second
  `doctor` reports `configured: true` with `foundFile`, and a re-run of `init-config` is
  idempotent (`skipped-existing`, file byte-identical).

## Dogfooding fix: Knip false positive on Stryker command runner (2026-06-10)

Running the standard tier (`sentiness check --tier=standard --trigger=pre-done`) surfaced a
blocking Knip finding introduced with `stryker.conf.json` (commit `00cce0a`): Knip's Stryker plugin
maps `testRunner: "command"` to a `@stryker-mutator/command-runner` dependency, but the command
runner is built into `@stryker-mutator/core` and no such npm package exists. Added it to
`ignoreDependencies` in `knip.json` — the same mechanism already used for the dynamic-import
false positives. The standard tier is clean again.

## Dogfooding incident: CLAUDE.md corruption (fixed 2026-06-09)

Running `install-skill --agent=claude-code` against this repository corrupted `CLAUDE.md` (commit
`00cce0a`): the spec quoted the literal `sentiness:start` / `sentiness:end` HTML-comment markers in
inline code, and the managed-section writer matched the first quoted pair, injecting the rendered
template into the middle of section T6.4.

Fix applied: the injected block was removed, every literal marker occurrence in `CLAUDE.md` was
rewritten to name the markers without their HTML-comment framing, T6.4/T6.1/T6.2 specs were
updated to match the implemented adapter surface (including `claude-code-skill`), and a new T6.5
spec documents the skill adapter. `docs/agent-skill.md` now warns that managed files must never
quote the literal markers.

Product follow-up **done 2026-06-10**: the managed-section writer now only matches markers that
occupy an entire line (`line.trim() === marker`), so inline-quoted marker text can never delimit
the section. Covered by a regression test reproducing this incident, an indented-marker test, and
a built-CLI smoke test against a file quoting the markers inline.

## Recommended next steps

The previously tracked items are all done (see the dated sections below). Current work: npm
publication (MIT license, metadata, GitHub remote — decided 2026-06-10).

Recently completed:

0. *(done 2026-06-10)* **One-command onboarding (T4.4)** — `sentiness init` now detects the stack
   (package manager, TS, test runner, Playwright, agent instruction files), recommends checks
   accordingly, lists all 11 checks (playwright was missing from the wizard), installs missing
   `@sentiness/check-*` packages and npm tools through the detected package manager **with
   consent** (exact command shown; failure warns and continues), installs agent instructions for
   detected agents, offers git hooks, then the baseline. New flags: `--install/--no-install`,
   `--skill=<agents|none>`, `--hooks/--no-hooks`. The legacy non-interactive contract
   (`--yes --checks=… --no-baseline`) is unchanged. Selected agents are recorded in
   `config.agents`.

1. *(done 2026-06-10)* **Playwright visual-feedback check** — implemented per `CLAUDE.md` T5.11
   (`@sentiness/check-playwright`, slow tier, screenshot/trace paths in `Finding.references`,
   `passRate` metric, 14 public release packages now) and T6.6 (skill template section
   "8. Visual Verification", `TEMPLATE_VERSION` 1.2, committed dogfooding skill regenerated).
2. *(resolved 2026-06-10 — see "Local binary resolution" below)*

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

# Sentiness — Instructions for AI Agents

> **Read this file in full before doing anything.** If you start coding without reading every section, you will violate constraints that are not visible in individual tasks. Re-read Sections 3, 6, and 7 whenever you start a new task.

---

## 1. What this project is

Sentiness is a CLI tool (Node.js, TypeScript) that runs quality checks on a codebase and produces a normalized JSON report optimized for AI coding agents to consume. It is invoked by an agent before declaring a task complete; it tells the agent what is wrong with the code in a way the agent can act on.

The product is built on three ideas:

1. **One JSON contract.** Every check (linter, mutation tester, dependency analyzer, security scanner) produces output in a single, versioned schema. The agent never parses tool-specific formats.
2. **Baseline-aware.** A codebase being adopted has pre-existing violations. Sentiness suppresses what was already there and only blocks on what is new in the current task.
3. **Tier-based.** Fast checks run after every edit; medium checks run before "done"; slow checks run in the background or in pre-push hooks. The agent never blocks idle waiting for a 5-minute mutation run.

This project is itself a TypeScript project. We will dogfood Sentiness on its own code once Phase 5 is reachable.

## 2. What this project is NOT

- **Not a SonarQube replacement.** No web dashboard, no historical database, no users/teams. CLI only.
- **Not a test runner.** It consumes coverage reports produced by the target project's runner (Vitest, Jest, or another Istanbul-compatible producer); it does not execute tests itself.
- **Not a code formatter.** Biome is invoked for lint, but auto-fix is the user's responsibility, not Sentiness's.
- **Not a CI server.** It runs locally and in CI as the same binary; orchestration is up to the user's CI provider.
- **Not a package manager.** It detects what is installed and reports gaps; it does not install dependencies behind the user's back (the `init` wizard does, with consent).

## 3. Non-negotiable rules

These rules override anything that seems convenient. Violating them is grounds for rejecting the work.

1. **No `any`.** Ever. If you reach for `any`, you have not understood the type. Use `unknown` and narrow, or define the type properly.
2. **No unsafe `as` casts.** Allowed: `as const`, branded-type constructors, and casts at trust boundaries (parsing JSON, reading process arguments). Boundary casts must be immediately followed by Zod validation or an equivalent explicit narrowing function.
3. **No global state.** No singletons, no module-level mutable variables, no `process.env` reads outside of a single config-loading module.
4. **No `console.log`.** Use the injected `Logger`. The CLI's stdout is reserved for the JSON report.
5. **No swallowed errors.** Never write `catch (e) {}`. Either handle the error meaningfully, wrap and rethrow with context, or let it propagate.
6. **No partial implementations committed.** A task is either done (with tests, types, docs) or not started. Do not commit `// TODO` for behavior that the task requires.
7. **Never modify `sentiness.config.js` or `.sentiness/baseline.json` to make a check pass.** These files represent intent; if a check is failing, fix the code or stop. If you genuinely believe the threshold is wrong, stop and surface it to the human in your final message.
8. **Never disable a test to make CI green.** If a test is wrong, fix the test with a clear commit message explaining why. If a test is flaky, mark it with `.skip` and open a follow-up task — do not delete it.
9. **One task per branch, one PR per task.** Tasks are sized to be small enough that this is feasible. If a task feels too big, stop and ask for it to be split.

## 4. Tech stack

| Layer | Tool | Version |
|---|---|---|
| Runtime | Node.js | `>=20.10` |
| Language | TypeScript | `5.4+`, `strict: true`, `noUncheckedIndexedAccess: true` |
| Package manager | pnpm | `9+` (workspace) |
| Lint/format | Biome | latest stable |
| Test runner | Vitest | latest stable, `@vitest/coverage-v8` coverage provider |
| Schema validation | Zod | `3.22+` |
| Property tests | fast-check | latest stable |
| CLI framework | `cac` | latest stable (small, no dependencies) |
| Hashing | Node built-in `crypto` (SHA-256) | — |

Forbidden:

- Jest (we use Vitest exclusively).
- Yup, Joi, io-ts (we use Zod exclusively).
- Lodash (use native methods or write a 3-line helper).
- Webpack/Rollup/esbuild for build (we use `tsc` for libraries and `tsup` only for the CLI bundle).
- Class inheritance beyond depth 1. Composition over inheritance.

## 5. Repository layout

```
sentiness/
├── packages/
│   ├── check-sdk/              # Public types and interfaces for plugin authors
│   ├── core/                   # CLI, runner, config, schema, baseline, jobs
│   ├── adapters/               # Skill generators per agent (Claude/Codex/Gemini)
│   └── checks/
│       ├── biome/
│       ├── dependency-cruiser/
│       ├── knip/
│       ├── coverage/
│       ├── stryker/
│       ├── osv-scanner/
│       ├── lockfile-lint/
│       ├── deps-diff/
│       ├── jscpd/
│       └── semgrep/
├── examples/
│   └── demo-project/           # Used by E2E tests
├── docs/
│   └── adr/                    # Architecture Decision Records
├── CLAUDE.md                   # This file
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── biome.json
└── package.json
```

Every package has the same internal layout:

```
<package>/
├── src/
│   ├── index.ts                # Public API (only what other packages import)
│   ├── <module>/
│   │   ├── <module>.ts
│   │   └── <module>.test.ts    # Co-located unit tests
├── package.json
├── tsconfig.json               # Extends ../../tsconfig.base.json
└── README.md                   # Brief: what this package does, how to use
```

**Co-locate tests next to source.** Do not use a top-level `__tests__/` folder. Test files end in `.test.ts`. Integration tests end in `.int.test.ts` and live in `<package>/test/integration/`.

## 6. Architecture principles (SOLID, applied)

Every task implementation must respect these. They are not abstract — each one has a concrete consequence in this project.

### Single Responsibility (SRP)

A module does one thing. Concretely:

- A `Check` plugin **only** runs one tool and normalizes its output. It does not load config, write reports, or manage baseline.
- The `Runner` **only** orchestrates check execution. It does not parse output or apply thresholds.
- The `Reporter` **only** maps already-filtered results into the report contract, derives agent instructions, and computes the documented exit code. It does not run checks or apply the baseline.
- The `BaselineManager` **only** loads/saves/queries the baseline file. It does not invent fingerprints; checks compute them with the SDK helper before baseline code sees findings.

Smell: a file longer than 250 lines almost always violates SRP. Stop and split.

### Open/Closed (OCP)

The core is closed for modification, open for extension via the `Check` interface. Adding a new check (e.g., `eslint-plugin-sonarjs`) means creating a new package in `packages/checks/` that implements `Check` — **no change** to `core` or `check-sdk` should be needed. If your task requires modifying `core` to accommodate a new check, stop and ask: the SDK is probably wrong.

### Liskov Substitution (LSP)

Any `Check` is interchangeable with any other from the runner's perspective. The runner does not branch on `check.id`. The same applies to `Logger`, `FileSystem`, and `BaselineManager` — implementations are swappable, including with test doubles.

### Interface Segregation (ISP)

Interfaces are small. The `Check` interface has 2 required methods (`detect`, `run`) and one optional (`dispose`). Normalization happens inside `run()`. The `Logger` has 4 methods (`debug`, `info`, `warn`, `error`). Don't add a method "in case someone needs it" — add it when a concrete implementation needs it.

### Dependency Inversion (DIP)

High-level modules depend on abstractions, not implementations. Concretely:

- The `Runner` receives a `Check[]` array; it does not import any check package directly.
- Checks receive a `CheckContext` containing `Logger`, `FileSystem`, `ProcessRunner`, and validated config; they do not read `process.env`, call `fs.readFile` directly, or import `child_process` directly.
- This is what makes tests possible without mocks of `fs` or `child_process`.

A package that imports from another package's `src/internal/` is wrong. Only `index.ts` exports are public.

## 7. Coding conventions

### TypeScript

- `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`.
- Prefer `type` over `interface` unless you need declaration merging.
- Discriminated unions for state. Example: `type CheckResult = { status: 'ok'; ... } | { status: 'violations'; ... } | { status: 'error'; ... }`.
- Use `readonly` on object properties and `ReadonlyArray<T>` (or `readonly T[]`) for immutable data.
- Branded types for IDs that must not be confused: `type RunId = string & { readonly __brand: 'RunId' }`.

### Naming

- `camelCase` for variables and functions, `PascalCase` for types and classes, `SCREAMING_SNAKE_CASE` for true constants only.
- Boolean variables and functions begin with `is`, `has`, `should`, `can`. Not `flag` or `enabled` (use `isEnabled`). Exception: user-facing config keys may use conventional names like `enabled` when that is the documented config contract.
- File names: `kebab-case.ts`. One main export per file when feasible.
- Test file mirrors source: `runner.ts` ↔ `runner.test.ts`.

### Error handling

- Define error classes per package: `class ConfigParseError extends Error`. Always set `this.name`.
- Errors carry a `cause` property when wrapping (`new ConfigParseError('...', { cause: err })`).
- Plugins **return** a `CheckResult` with `status: 'error'`; they do not throw out of `run()`. If they do throw, the runner catches and converts.
- The CLI's outermost handler catches everything, logs to stderr, and exits with code 3.

### Async

- Always `await` (no floating promises). The lint config will catch this; do not disable the rule.
- Use `Promise.all` for concurrency only when items are independent. Use a controlled concurrency primitive (write a 20-line `pLimit` if needed; do not pull `p-limit`) when there's a fan-out limit.
- Every long-running async operation accepts an `AbortSignal`.

### Imports

- Use `node:` prefix for built-ins: `import { readFile } from 'node:fs/promises'`.
- No circular imports. If you need one, the abstraction is wrong.
- Imports order: node built-ins → third-party → workspace packages → relative. Biome enforces this.

## 8. Testing strategy

### Pyramid

- **Unit tests** (~80% of tests): pure functions, single classes, no I/O. Fast, deterministic.
- **Integration tests** (~15%): exercise a package across several modules with real implementations of internal collaborators. Mock only at the I/O boundary (filesystem, network, child_process).
- **E2E tests** (~5%): run the actual CLI binary against `examples/demo-project/`. Located in `packages/core/test/e2e/`.

### Coverage

- Each package: minimum 85% line coverage, 80% branch.
- Coverage is enforced by Vitest config. Do not lower thresholds.
- `index.ts` files (re-exports) are excluded.

### What to test

- **Always test:** public functions exported from `index.ts`, error paths, edge cases (empty input, single element, large input), all branches of discriminated unions.
- **Use property-based tests** (`fast-check`) for: fingerprint computation, baseline matching, severity reduction, JSON schema invariants.
- **Snapshot tests** are allowed only for the final JSON report shape, gated behind a stable input fixture.
- **Do not test:** type-only code, private functions (test them through the public surface), third-party libraries.

### Mocking

- Prefer real implementations with controlled inputs. A `FileSystem` interface with an in-memory implementation beats `vi.mock('fs')`.
- When you must mock, mock at the interface level, not the module level.
- Never mock `Date.now()` globally. Inject a `Clock` interface or pass a timestamp argument.

## 9. How to develop locally

```bash
# Bootstrap (once)
pnpm install

# Develop
pnpm -r --parallel build --watch    # Build all packages in watch mode
pnpm -r --parallel test --watch     # Run all tests in watch mode

# Single package
pnpm --filter @sentiness/core test
pnpm --filter @sentiness/core build

# Type check everything
pnpm -r typecheck

# Lint everything
pnpm lint

# Run the CLI from source (after build)
pnpm --filter @sentiness/core run dev -- check --tier=fast
```

If a command above does not exist yet, your task may need to add it. Check Phase 0 first.

## 10. Task organization

Tasks are grouped into phases. **Phases are sequential**: do not start Phase 1 work before Phase 0 is complete. **Within a phase, tasks marked "parallel-safe" can be done concurrently** because they touch disjoint files.

Each task below has:

- **ID** (`T<phase>.<n>`)
- **Depends on** — tasks that must be complete before this one starts. The implementation cannot compile or function without them.
- **Soft-depends on** (when present) — tasks that *enhance* this one but are not required for it to compile or pass tests. The implementation must degrade gracefully when the soft dependency is absent (typically by detecting absence at runtime and emitting a clear message).
- **Blocks** — tasks that cannot start until this one is complete
- **Parallel-safe with** — tasks within the same phase that touch no shared files
- **Files** — exact paths to create or modify (no surprises)
- **Public interface** — what other packages will import; this is a hard contract
- **Implementation notes** — non-obvious things that will save you time
- **Acceptance criteria** — checkboxes that must all be true to mark done
- **Tests required** — minimum test set; you may add more

To claim a task: open a branch named `task/T<id>-<short-slug>`. The first commit on the branch must update `docs/progress.md` to mark the task as in-progress.

---

## 11. Tasks

> **Inter-phase ordering note.** Phases 0 → 1 → 2/3 → 4/5/6 → 7 is the *typical* sequence, but with two intentional exceptions: (a) Phase 5 (checks) can start as soon as T1.7 and Phase 2 finish, in parallel with Phases 3 and 4; (b) Phase 6 (adapters) can start as soon as T0.2 and T6.4 are done, because adapters only depend on `FileSystem` and the shared skill template. The CLI commands `install-skill` (T4.1) and `init` (T4.2) carry `Soft-depends on: T6.*` to reflect that these commands gain functionality once Phase 6 lands but compile and run before then.

### Phase 0 — Foundation

> **Sequential.** All Phase 0 tasks must complete before anyone starts Phase 1.

#### T0.1 — Monorepo bootstrap

**Depends on:** none
**Blocks:** all other tasks
**Parallel-safe with:** none

**Files:**
- `package.json` (root)
- `pnpm-workspace.yaml`
- `tsconfig.base.json`
- `biome.json`
- `.gitignore`
- `.nvmrc`
- `vitest.config.base.ts`
- `docs/progress.md` (empty table)

**Implementation notes:**
- `pnpm-workspace.yaml` lists `packages/*` and `packages/checks/*`.
- `tsconfig.base.json` enables `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `target: ES2022`, `module: NodeNext`, `moduleResolution: NodeNext`.
- Root `package.json` has `private: true` and scripts: `build`, `test`, `lint`, `typecheck` that fan out via `pnpm -r`.
- `biome.json` configures formatting (2 spaces, single quotes, trailing commas) and the import order rule mentioned in §7.
- `vitest.config.base.ts` configures coverage with `provider: 'v8'`, line threshold 85%, branch threshold 80%, and excludes `index.ts` re-export files.
- `.gitignore` ignores `.sentiness/jobs/`, `.sentiness/cache/`, `.sentiness/pending-feedback.json`, `coverage/`, and build outputs. It does **not** ignore `sentiness.config.js` or `.sentiness/baseline.json`.

**Acceptance criteria:**
- [ ] `pnpm install` succeeds on a fresh clone.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` all run (even with no packages yet) and exit 0.
- [ ] Node version is enforced via `engines.node` in root package.json.

**Tests required:** none (this is config).

---

#### T0.2 — Check SDK package

**Depends on:** T0.1
**Blocks:** T1.*, T2.*, T5.*
**Parallel-safe with:** T0.4

**Files:**
- `packages/check-sdk/package.json`
- `packages/check-sdk/tsconfig.json`
- `packages/check-sdk/src/index.ts`
- `packages/check-sdk/src/types.ts`
- `packages/check-sdk/src/types.test.ts`
- `packages/check-sdk/src/fingerprint.ts`
- `packages/check-sdk/src/fingerprint.test.ts`
- `packages/check-sdk/README.md`

**Public interface (must be exported from `index.ts`):**

```ts
export type CheckId = string & { readonly __brand: 'CheckId' };
export type RuleId = string & { readonly __brand: 'RuleId' };
export type Tier = 'fast' | 'standard' | 'slow';
export type Category =
  | 'lint'
  | 'architecture'
  | 'test-quality'
  | 'coverage'
  | 'security'
  | 'duplication'
  | 'complexity'
  | 'platform';   // reserved for runner-generated synthetic results (e.g. check-load failures)
export type Severity = 'error' | 'warning' | 'info';

export interface Location {
  readonly file: string;          // path relative to project root
  readonly startLine?: number;    // 1-indexed
  readonly startColumn?: number;
  readonly endLine?: number;
  readonly endColumn?: number;
  readonly packageName?: string;  // for dep findings
  readonly packageVersion?: string;
}

export interface Suggestion {
  readonly kind: 'refactor' | 'add-test' | 'upgrade' | 'remove' | 'rename' | 'other';
  readonly description: string;
  readonly command?: string;
}

export interface Finding {
  readonly id: string;            // stable id like 'osv:GHSA-xxx' or 'biome:lint/style/useConst'
  readonly checkId: CheckId;
  readonly ruleId: RuleId;
  readonly severity: Severity;
  readonly message: string;
  readonly location: Location;
  readonly snippet?: string;
  readonly suggestion?: Suggestion;
  readonly references?: readonly string[];
  readonly fingerprint: string;   // non-empty SHA-256 hex computed with computeFingerprint before returning
  readonly introducedInDiff?: boolean;  // set by core
}

export interface CheckMetrics {
  readonly [name: string]: number | string | boolean;
}

export type CheckStatus = 'ok' | 'violations' | 'error' | 'skipped';

export interface CheckResult {
  readonly status: CheckStatus;
  readonly findings: readonly Finding[];
  readonly metrics?: CheckMetrics;
  readonly rawOutputPath?: string;
  readonly durationMs: number;
  readonly skipReason?: string;   // when status is 'skipped'
  readonly errorMessage?: string; // when status is 'error'
}

export interface DetectResult {
  readonly available: boolean;
  readonly reason?: string;       // when not available
  readonly version?: string;
}

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export interface FileSystem {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  appendFile(path: string, content: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
  chmod(path: string, mode: number): Promise<void>;
  readDir(path: string): Promise<readonly string[]>;
  stat(path: string): Promise<{ isFile: boolean; isDirectory: boolean; size: number; mtimeMs: number }>;
  realpath(path: string): Promise<string>;
}

export interface Clock {
  now(): number;       // epoch ms
  isoNow(): string;    // ISO 8601 string for the current moment
}

export interface GitProvider {
  isRepo(cwd: string): Promise<boolean>;
  currentBranch(cwd: string): Promise<string>;
  changedFiles(cwd: string, baseRef: string): Promise<readonly string[]>;
  fileContentAtRef(cwd: string, ref: string, path: string): Promise<string | null>;
  mergeBase(cwd: string, refA: string, refB: string): Promise<string>;
  showCommit(cwd: string, ref: string): Promise<{ sha: string; date: string; author: string }>;
}

export interface ExecFileOptions {
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

export interface ExecFileResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly signal?: string;
}

export interface ProcessRunner {
  execFile(command: string, args: readonly string[], options?: ExecFileOptions): Promise<ExecFileResult>;
}

export interface CheckContext {
  readonly cwd: string;
  readonly tier: Tier;
  readonly trigger: string | null;
  readonly baseRef: string | null;
  readonly changedFiles: readonly string[];
  readonly diffOnly: boolean;
  readonly signal: AbortSignal;
  readonly logger: Logger;
  readonly fs: FileSystem;
  readonly process: ProcessRunner;
  readonly checkConfig: Record<string, unknown>; // validated upstream
}

export interface Check {
  readonly id: CheckId;
  readonly category: Category;
  readonly defaultTier: Tier;
  detect(ctx: CheckContext): Promise<DetectResult>;
  run(ctx: CheckContext): Promise<CheckResult>;
  dispose?(): Promise<void>;
}
export interface FingerprintInput {
  readonly checkId: CheckId;
  readonly ruleId: RuleId;
  readonly relativeFilePath: string;
  readonly lineContent: string;
  readonly extraDiscriminator?: string;
}

export function computeFingerprint(input: FingerprintInput): string;
export function normalizeFingerprintLine(line: string): string;
```

**Implementation notes:**
- This package has **zero external runtime dependencies**. It may contain tiny runtime helpers that use Node built-ins.
- Branded types (`CheckId`, `RuleId`) are nominal-typing tricks. Provide tiny constructor helpers (`asCheckId(s: string): CheckId`) but no validation here — that's the registry's job.
- Do not add `normalize()` to the interface yet — `run()` returns `CheckResult` directly. The plugin internally transforms native tool output into `Finding[]`. We removed the separate `normalize` step from the original plan because it added a phase without clear benefit.
- `computeFingerprint` lives in `check-sdk` so check packages do not need to import from `core`. This avoids a package dependency cycle: core loads checks, checks depend only on the SDK.
- Fingerprint algorithm (must match exactly):
  1. `normalizedLine = normalizeFingerprintLine(input.lineContent)`: strip trailing newline, trim leading/trailing whitespace, collapse internal whitespace runs (`\s+`) to one space, and do **not** strip comments.
  2. `payload = [checkId, ruleId, relativeFilePath, normalizedLine, extraDiscriminator ?? ''].join('\u0000')`.
  3. `fingerprint = sha256(payload).hex()`, always 64 lowercase hex characters.
- The NUL separator prevents cross-field collisions where simple concatenation would collide. Empty `extraDiscriminator` is equivalent to `undefined`.
- For dependency or repository-level findings that do not have a meaningful source line, use `lineContent: ''` and put the stable identity (for example `packageName@packageVersion` or vulnerability id) in `extraDiscriminator`.
- Tests verify type-level constraints with `expectTypeOf` from Vitest.

**Acceptance criteria:**
- [ ] All types above exported from `index.ts`.
- [ ] No runtime code beyond branded type constructors, severity ordering, and fingerprint helpers.
- [ ] README explains the contract for plugin authors with a 30-line minimal example.
- [ ] `pnpm --filter @sentiness/check-sdk typecheck` passes.

**Tests required:**
- [ ] Type-level tests using `expectTypeOf` for each exported type.
- [ ] Unit tests for the `Severity` ordering helper.
- [ ] Unit and property tests for `computeFingerprint` and `normalizeFingerprintLine`.

---

#### T0.3 — Report schema

**Depends on:** T0.1, T0.2
**Blocks:** T1.4 (Reporter), T7.1 (E2E)
**Parallel-safe with:** T0.4

**Files:**
- `packages/core/package.json` (initial)
- `packages/core/tsconfig.json`
- `packages/core/src/schema/report.ts`
- `packages/core/src/schema/report.test.ts`
- `packages/core/schema/report.schema.json` (generated, committed)

**Public interface:**

```ts
// in packages/core/src/schema/report.ts
import { z } from 'zod';

export const ReportSchema = z.object({ /* full shape from Appendix A */ });
export type Report = z.infer<typeof ReportSchema>;
export const SCHEMA_VERSION = '1.0' as const;
```

**Implementation notes:**
- Use Zod schema as source of truth. Generate JSON Schema from it via `zod-to-json-schema` and commit the output.
- Schema must match exactly the shape defined in **Appendix A** of this document. If the doc and the code diverge, **the doc wins** — open a follow-up to fix the doc, do not "improve" the schema unilaterally.
- Add a top-level `schemaVersion` field validated against a literal.
- Every `Finding` in the report has `fingerprint: string` (non-empty SHA-256 hex).

**Acceptance criteria:**
- [ ] `Report` type round-trips through `ReportSchema.parse(JSON.parse(JSON.stringify(report)))`.
- [ ] Generated JSON Schema is committed and matches Zod definition.
- [ ] Invalid reports throw `ZodError` with field path.

**Tests required:**
- [ ] Parse a known-good fixture report.
- [ ] Reject a report with missing required fields.
- [ ] Reject a report with wrong `schemaVersion`.
- [ ] Property-based test: any valid `Report` survives JSON round-trip.

---

#### T0.4 — Test harness conventions

**Depends on:** T0.1, T0.2 (needs `FileSystem`, `Clock`, `Logger`, `GitProvider` interfaces)
**Blocks:** none (advisory)
**Parallel-safe with:** T0.3

**Files:**
- `vitest.config.base.ts`
- `packages/_test-utils/package.json`
- `packages/_test-utils/src/index.ts`
- `packages/_test-utils/src/in-memory-fs.ts`
- `packages/_test-utils/src/in-memory-fs.test.ts`
- `packages/_test-utils/src/fake-process-runner.ts`
- `packages/_test-utils/src/in-memory-git.ts`
- `packages/_test-utils/src/silent-logger.ts`
- `packages/_test-utils/src/clock.ts`
- `docs/testing-guide.md`

**Public interface:**

```ts
export class InMemoryFileSystem implements FileSystem { /* ... */ }
export class SilentLogger implements Logger { /* records calls for assertions */ }
export class FixedClock implements Clock { now(): number; isoNow(): string; advance(ms: number): void; }
export class FakeProcessRunner implements ProcessRunner { /* scripted execFile responses */ }
export class InMemoryGitProvider implements GitProvider { /* scripted repo state */ }
export function makeContext(overrides?: Partial<CheckContext>): CheckContext;
```

**Implementation notes:**
- `InMemoryFileSystem` stores files in a `Map<string, string>` keyed by normalized absolute path. Implements every `FileSystem` method.
- `SilentLogger` keeps an array of `{ level, message, fields }` for tests to inspect. Does not write to stdout/stderr.
- `FakeProcessRunner` records each command invocation and returns preconfigured `ExecFileResult` values. Prefer it over mocking `child_process` in check tests.
- `InMemoryGitProvider` supports changed-file and file-at-ref fixtures without creating a real repo.
- The package name starts with `_` to indicate it's not published.

**Acceptance criteria:**
- [ ] All test helpers exported from `index.ts`.
- [ ] `InMemoryFileSystem` passes a conformance test that any valid `FileSystem` implementation must pass (write the conformance test here too, exported as `runFileSystemContractTests(makeFs: () => FileSystem)`).
- [ ] Testing guide document explains pyramid, naming, when to mock.

**Tests required:**
- [ ] Tests for the test helpers themselves (yes, this matters).

---

### Phase 1 — Core

> **Within phase 1, T1.1 through T1.7 are mostly parallel-safe** because each owns a separate module. T1.3 (Runner) depends on the runner-adjacent modules being typed at least, so its implementation is blocked until T1.1, T1.2, T1.5, and T1.6 are done. T1.7 is independent but must land before package-manager-aware checks.

#### T1.1 — Config loader

**Depends on:** T0.2 (uses `Tier`, `Category`, `FileSystem`)
**Blocks:** T1.3, T4.1
**Parallel-safe with:** T1.2, T1.4 (after types ready), T1.5, T1.6

**Files:**
- `packages/core/src/config/config.ts`
- `packages/core/src/config/config.test.ts`
- `packages/core/src/config/schema.ts`
- `packages/core/src/config/defaults.ts`

**Public interface:**

```ts
export interface SentinessConfig { /* shape; fields below */ }
export interface ResolvedConfig extends SentinessConfig { /* with defaults applied */ }

export class ConfigParseError extends Error { /* with cause */ }
export class ConfigNotFoundError extends Error { }

export async function loadConfig(cwd: string, fs: FileSystem): Promise<ResolvedConfig>;
export function validateConfig(input: unknown): SentinessConfig;  // throws ConfigParseError
export const DEFAULT_CONFIG: ResolvedConfig;
```

**`SentinessConfig` shape:**

```ts
{
  schemaVersion: '1.0',
  tiers: {
    fast: { triggers: ('post-edit' | 'pre-commit')[], timeoutMs: number },
    standard: { triggers: ('pre-done')[], timeoutMs: number },
    slow: { triggers: ('pre-push' | 'pre-pr' | 'manual')[], timeoutMs: number },
  },
  checks: {
    [checkId: string]: {
      enabled: boolean,
      tier?: 'fast' | 'standard' | 'slow',  // overrides default
      thresholds?: Record<string, number | string>,
      [key: string]: unknown,  // check-specific
    },
  },
  baseline: { path: string },                                 // default '.sentiness/baseline.json'
  pending: { path: string },                                  // default '.sentiness/pending-feedback.json'
  reporting: { compact: boolean, omitOk: boolean, warningsAreErrors: boolean },
  agents: ('claude-code' | 'codex' | 'gemini')[],             // consumed by `install-skill --agent=all` and the init wizard to know which adapter files to maintain
}
```

**Implementation notes:**
- Config file is `sentiness.config.js` (ESM) or `sentiness.config.json`. Try `.js` first.
- For `.js`: dynamic `import(pathToFileURL)`.
- For `.json`: `fs.readFile` + `JSON.parse` + `validateConfig`.
- If neither exists, throw `ConfigNotFoundError` (caller decides whether to use defaults).
- Defaults from `DEFAULT_CONFIG` are deep-merged with user input (per-check options merge, not overwrite).
- Validate tier triggers: a trigger may only appear in one tier (otherwise it's ambiguous which runs).

**Acceptance criteria:**
- [ ] Loads valid `sentiness.config.js` and `sentiness.config.json`.
- [ ] Applies defaults for missing fields.
- [ ] Throws `ConfigParseError` with field path on invalid input.
- [ ] Throws `ConfigNotFoundError` when no config file present.
- [ ] Rejects configs where a trigger appears in multiple tiers.

**Tests required:**
- [ ] Each error path.
- [ ] Default merging at every level (top-level, tier, check).
- [ ] Validation round-trip: valid JSON fixtures parse, defaults merge, and serializing the resolved object back to JSON preserves the same semantic values.

---

#### T1.2 — Plugin registry

**Depends on:** T0.2 (uses `Check` interface, `FileSystem`), T1.1 (uses `ResolvedConfig`)
**Blocks:** T1.3
**Parallel-safe with:** T1.4 (after types ready), T1.5, T1.6

**Files:**
- `packages/core/src/registry/registry.ts`
- `packages/core/src/registry/registry.test.ts`
- `packages/core/src/registry/loader.ts`

**Public interface:**

```ts
export class CheckRegistry {
  static async fromConfig(config: ResolvedConfig, cwd: string): Promise<CheckRegistry>;
  list(): readonly Check[];
  get(id: CheckId): Check | undefined;
  filterByTier(tier: Tier): readonly Check[];
  loadFailures(): readonly CheckLoadFailure[];
}

export class CheckNotFoundError extends Error { }
export class CheckLoadError extends Error { }

export interface CheckLoadFailure {
  readonly requestedId: CheckId;
  readonly moduleName: string;
  readonly message: string;
}
```

**Implementation notes:**
- Discovery: read each enabled `checks[id]` from config, validate `id` against `^[a-z0-9][a-z0-9-]*$`, resolve module name `@sentiness/check-${id}` from `cwd`'s `node_modules`, then `import()` and validate that default export implements `Check`.
- Validation: presence of `id`, `category`, `defaultTier`, `detect`, and `run` (`typeof === 'function'` for methods).
- Failed loads do not crash the registry — they're recorded in `loadFailures()` and surfaced by the runner as synthetic `CheckResult` entries with `status: 'error'`. Reasoning: one broken plugin should not block all the others.
- `filterByTier` honors per-check tier override from config.

**Acceptance criteria:**
- [ ] Loads checks from a fixture project's node_modules.
- [ ] Skips disabled checks.
- [ ] Honors tier override.
- [ ] Surfaces load failures without crashing.

**Tests required:**
- [ ] Use temporary fixture `node_modules` packages or an injected module-loader test seam to test all paths. Do not pretend `InMemoryFileSystem` can satisfy Node's dynamic `import()`.

---

#### T1.3 — Runner

**Depends on:** T1.1, T1.2, T1.5, T1.6
**Blocks:** T1.4 (consumes `RunOutcome`), T2.2 (consumes `RunOutcome`), T4.1 (CLI command)
**Parallel-safe with:** none in phase 1 (T1.4 depends on T1.3's `RunOutcome` shape — see note below)

**Files:**
- `packages/core/src/runner/runner.ts`
- `packages/core/src/runner/runner.test.ts`
- `packages/core/src/runner/concurrency.ts`
- `packages/core/src/runner/concurrency.test.ts`

**Public interface:**

```ts
export interface RunOptions {
  readonly tier?: Tier;
  readonly trigger?: string;
  readonly diffOnly: boolean;
  readonly baseRef?: string;
  readonly maxConcurrency?: number;
  readonly signal?: AbortSignal;
}

export interface RunInput {
  readonly registry: CheckRegistry;
  readonly config: ResolvedConfig;
  readonly cwd: string;
  readonly fs: FileSystem;
  readonly process: ProcessRunner;
  readonly logger: Logger;
  readonly clock: Clock;
  readonly git: GitProvider;
}

export async function runChecks(input: RunInput, options: RunOptions): Promise<RunOutcome>;

export interface RunOutcome {
  readonly runId: string;
  readonly results: ReadonlyMap<CheckId, CheckResult>;
  readonly checkMetadata: ReadonlyMap<CheckId, { readonly category: Category }>;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly context: RunContext;
}

export type RunMode = 'diff' | 'trend' | 'full';

export interface RunContext {
  readonly cwd: string;
  readonly tier: Tier;
  readonly trigger: string | null;
  readonly mode: RunMode;
  readonly baseRef: string | null;
  readonly headRef: string | null;
  readonly changedFiles: readonly string[];
}
```

**Implementation notes:**
- Filter checks by tier. If only `trigger` is provided, resolve its tier from config. If both `tier` and `trigger` are provided, reject mismatches rather than silently choosing one. If neither is provided, default to `standard`.
- For each check: call `detect(ctx)`. If `available: false`, record as `skipped`.
- Include registry `loadFailures()` as synthetic error results so the report shows broken plugins explicitly.
- Store per-check metadata needed by the report contract (`category` at minimum) in `RunOutcome.checkMetadata`. The reporter must not import the registry just to recover this information.
- Apply per-tier `timeoutMs` via `AbortController` chained from `options.signal`.
- Concurrency: default `Math.max(1, os.cpus().length - 1)`, configurable. Implement a small `pLimit` in `concurrency.ts` (no third-party deps).
- A check that throws despite having a result contract is wrapped: `{ status: 'error', errorMessage: ... }`.
- Track per-check timing via injected `Clock`.
- Diff resolution: if `diffOnly`, get changed files via `GitProvider`. Pass `tier`, `trigger`, `baseRef`, `changedFiles`, and `ProcessRunner` to each check via `CheckContext`.
- Runner does **not** apply baseline. That's a downstream concern (T2.3).

**Acceptance criteria:**
- [ ] Runs all matching checks; results map keyed by check id.
- [ ] Honors timeout per tier (verified with a slow fake check).
- [ ] Continues on individual check failures.
- [ ] Honors `AbortSignal` from caller.
- [ ] Concurrency limit respected (verified by counting concurrent invocations of fake checks).

**Tests required:**
- [ ] Happy path with multiple fake checks.
- [ ] Timeout path.
- [ ] Throwing-check path.
- [ ] Detect-failure path.
- [ ] Cancellation mid-run.
- [ ] Concurrency limit respected.

---

#### T1.4 — Reporter

**Depends on:** T0.3, T1.3 (consumes `RunOutcome`)
**Blocks:** T4.1
**Parallel-safe with:** none in phase 1 (but see note: implementation can proceed in parallel with T1.3 once `RunOutcome` is exported, since this task only consumes types)

**Files:**
- `packages/core/src/reporter/reporter.ts`
- `packages/core/src/reporter/reporter.test.ts`
- `packages/core/src/reporter/agent-instructions.ts`

**Public interface:**

```ts
export interface ReporterOptions {
  readonly compact: boolean;        // omit ok checks
  readonly omitOk: boolean;         // synonym, prefer 'compact'
  readonly maxFindingsPerCheck?: number;  // truncate with note; default 50
}

export interface ReportMetricRegression {
  readonly metric: string;
  readonly baselineValue: number;
  readonly currentValue: number;
  readonly direction: 'higher-is-better' | 'lower-is-better';
}

export interface ReportInput {
  readonly outcome: RunOutcome;                  // findings already filtered by baseline when baseline applies
  readonly baselineApplied: boolean;
  readonly baselinePath: string | null;
  readonly suppressedCount: number;
  readonly metricRegressions: readonly ReportMetricRegression[];
}

export function buildReport(
  input: ReportInput,
  config: ResolvedConfig,
  options: ReporterOptions,
): Report;

export function exitCodeFor(report: Report): 0 | 1 | 2 | 3;
```

**Implementation notes:**
- Maps `ReportInput` into the `Report` shape from Appendix A. The reporter does not call `applyBaseline`; it receives already-filtered findings.
- `compact: true` removes checks with `status: 'ok'` and no findings. Their existence is still summarized in `summary.checksRun`.
- `agentInstructions` block is computed by `agent-instructions.ts`: groups blocking findings into `mustFix`, non-blocking errors/warnings into `shouldFix`, info into `informational`. Sort by severity then file.
- Exit code: 0 if `summary.blocking === false`; 1 if there is at least one blocking `error`; 2 if there are no blocking errors but warnings are promoted by `config.reporting.warningsAreErrors`; 3 reserved for Sentiness/runtime failure.
- Truncation: if a check has more than `maxFindingsPerCheck` findings, keep top N by severity, add `truncated: { total, shown }` field. Prevents 5000-finding reports from blowing up agent context.
- `context.addedDependencies` and `context.removedDependencies` are derived from `deps-diff` findings (`ruleId: 'new-dependency'` and `ruleId: 'removed-dependency'`) so the runner does not need package-specific knowledge.

**Acceptance criteria:**
- [ ] Produces a report that validates against `ReportSchema`.
- [ ] `compact` flag omits ok checks.
- [ ] Truncation works and is reported.
- [ ] Exit code is correct for each case.

**Tests required:**
- [ ] Snapshot test on a deterministic outcome fixture.
- [ ] Property test: every `Report` produced validates against schema.
- [ ] Exit code matrix.

---

#### T1.5 — Logger

**Depends on:** T0.2
**Blocks:** T1.3 (uses it)
**Parallel-safe with:** T1.1, T1.2, T1.4, T1.6

**Files:**
- `packages/core/src/logger/logger.ts`
- `packages/core/src/logger/logger.test.ts`

**Public interface:**

```ts
export interface LoggerOptions {
  readonly level: 'debug' | 'info' | 'warn' | 'error';
  readonly stream: NodeJS.WritableStream;  // typically process.stderr
  readonly format: 'pretty' | 'json';
}

export function createLogger(options: LoggerOptions): Logger;
export function withContext(base: Logger, fields: Record<string, unknown>): Logger;
```

**Implementation notes:**
- Always writes to **stderr**, never stdout (stdout is reserved for the report JSON).
- `pretty`: human-readable with timestamps and level. `json`: one line per log, JSON object.
- `withContext` produces a derived logger that prepends fields to every call. Used to scope per-check.

**Acceptance criteria:**
- [ ] Levels filtered correctly.
- [ ] JSON format produces valid JSON per line.
- [ ] `withContext` does not mutate base logger.
- [ ] Never writes to stdout.

**Tests required:**
- [ ] Capture stream and assert content per level.
- [ ] Verify stdout is untouched by writing to a stream and checking its content.

---

#### T1.6 — Git provider

**Depends on:** T0.1, T0.2 (implements `GitProvider` interface from check-sdk)
**Blocks:** T1.3 (uses it for diff), T2.* (baseline uses base ref), T5.* (deps-diff uses it)
**Parallel-safe with:** T1.1, T1.2, T1.4, T1.5

**Files:**
- `packages/core/src/git/git.ts`
- `packages/core/src/git/git.test.ts`

**Public interface:**

```ts
import type { GitProvider, ProcessRunner } from '@sentiness/check-sdk';

export function createGitProvider(process: ProcessRunner): GitProvider;  // shells out to `git`

export class GitError extends Error {
  constructor(message: string, readonly command: string, readonly stderr: string);
}
```

**Implementation notes:**
- Implementation shells out to `git` via the injected `ProcessRunner.execFile` (never shell strings — argument injection risk).
- `changedFiles` uses `git diff --name-only <baseRef>...HEAD` and excludes deleted files.
- All methods accept a `cwd`. Never depend on `process.cwd()`.
- For tests, an `InMemoryGitProvider` lives in `_test-utils`.

**Acceptance criteria:**
- [ ] All methods documented and typed.
- [ ] Errors from git surfaced with the failing command in the message.
- [ ] Works with a real repo fixture (integration test).

**Tests required:**
- [ ] Unit tests using `FakeProcessRunner`.
- [ ] Integration test against a temporary git repo created in setup.

---

#### T1.7 — Package metadata detector

**Depends on:** T0.2
**Blocks:** T4.2, T5.6, T5.7, T5.8
**Parallel-safe with:** T1.1, T1.2, T1.3 (after types ready), T1.4, T1.5, T1.6

**Files:**
- `packages/core/src/package-metadata/package-metadata.ts`
- `packages/core/src/package-metadata/package-metadata.test.ts`

**Public interface:**

```ts
export type PackageManager = 'pnpm' | 'npm' | 'yarn' | 'unknown';

export interface LockfileInfo {
  readonly path: string;
  readonly kind: 'pnpm-lock' | 'package-lock' | 'yarn-lock' | 'npm-shrinkwrap';
}

export interface PackageMetadata {
  readonly packageJsonPath: string | null;
  readonly packageManager: PackageManager;
  readonly lockfiles: readonly LockfileInfo[];
  readonly dependencies: Readonly<Record<string, string>>;
  readonly devDependencies: Readonly<Record<string, string>>;
  readonly optionalDependencies: Readonly<Record<string, string>>;
}

export async function detectPackageMetadata(cwd: string, fs: FileSystem): Promise<PackageMetadata>;
```

**Implementation notes:**
- Package-manager detection order: `pnpm-lock.yaml` → `package-lock.json` / `npm-shrinkwrap.json` → `yarn.lock` → `packageManager` field in `package.json` → `unknown`.
- Return all lockfiles found, not just the first. Some repos intentionally keep multiple lockfiles during migration; checks decide which ones they support.
- Parse `package.json` with Zod. Missing dependency sections become empty records.
- Never install packages and never run a package manager here.

**Acceptance criteria:**
- [ ] Detects pnpm, npm, yarn, npm-shrinkwrap, multiple-lockfile, and no-lockfile cases.
- [ ] Malformed `package.json` produces a typed error with file path.
- [ ] Missing `package.json` returns `packageJsonPath: null` and empty dependency records.

**Tests required:**
- [ ] One fixture per supported lockfile.
- [ ] Multiple lockfiles preserve deterministic order.
- [ ] Malformed package JSON error path.

---

### Phase 2 — Baseline

> The fingerprint helper is part of T0.2 (`@sentiness/check-sdk`), not core. This is intentional: core loads check packages at runtime, so check packages must not import from core just to compute fingerprints.

#### T2.2 — Baseline manager

**Depends on:** T0.2, T0.4, T1.3 (consumes `RunOutcome` in `createFromOutcome`), T1.6 (uses `GitProvider` for commit SHA)
**Blocks:** T2.3
**Parallel-safe with:** T3.* (jobs are independent)

**Files:**
- `packages/core/src/baseline/baseline.ts`
- `packages/core/src/baseline/baseline.test.ts`
- `packages/core/src/baseline/schema.ts`

**Public interface:**

```ts
export interface BaselineEntry {
  readonly checkId: CheckId;
  readonly ruleId: RuleId;
  readonly fingerprint: string;
  readonly location: { readonly file: string; readonly startLine?: number };
  readonly addedAt: string;
  readonly reason: string;
}

export interface MetricBaseline {
  readonly value: number;
  readonly direction: 'higher-is-better' | 'lower-is-better';
}

export interface BaselineSnapshot {
  readonly schemaVersion: '1.0';
  readonly createdAt: string;
  readonly createdAtCommit: string;
  readonly suppressed: ReadonlyArray<BaselineEntry>;
  readonly metrics: Readonly<Record<string, MetricBaseline>>;
}

export class BaselineManager {
  static async load(path: string, fs: FileSystem): Promise<BaselineSnapshot | undefined>;
  static async save(path: string, snapshot: BaselineSnapshot, fs: FileSystem): Promise<void>;
  static async createFromOutcome(
    outcome: RunOutcome,
    git: GitProvider,
    cwd: string,
  ): Promise<BaselineSnapshot>;
  static prune(snapshot: BaselineSnapshot, currentFingerprints: ReadonlySet<string>): BaselineSnapshot;
  static accept(snapshot: BaselineSnapshot, finding: Finding, reason: string): BaselineSnapshot;
}

export class BaselineAcceptError extends Error { }
```

**Implementation notes:**
- Storage format: pretty-printed JSON, sorted by fingerprint within `suppressed` for stable diffs.
- `createFromOutcome` collects all findings, builds a `BaselineSnapshot` with `reason: 'initial baseline'`.
- `metrics` is a JSON object, not a `Map`, so load/save round-trips without custom serialization.
- `prune` is pure: returns a new snapshot keeping only entries whose fingerprint appears in `currentFingerprints`.
- `accept` returns a new snapshot adding the finding's fingerprint.
- Reject `accept` with empty reason — throw `BaselineAcceptError`.

**Acceptance criteria:**
- [ ] Load → save → load is identity.
- [ ] Stored JSON is sorted (verified with snapshot test).
- [ ] Prune removes only matching entries.
- [ ] Accept rejects empty reason.
- [ ] Metrics direction is preserved.

**Tests required:**
- [ ] Round-trip with `InMemoryFileSystem`.
- [ ] Prune semantics.
- [ ] Reject malformed file with clear error.

---

#### T2.3 — Diff filter (baseline application)

**Depends on:** T2.2, T1.3
**Blocks:** T4.1 (CLI must apply baseline before reporting)
**Parallel-safe with:** none in phase 2

**Files:**
- `packages/core/src/baseline/diff-filter.ts`
- `packages/core/src/baseline/diff-filter.test.ts`

**Public interface:**

```ts
export interface BaselineApplication {
  readonly outcome: RunOutcome;                  // copy with post-filter findings and introducedInDiff tags
  readonly baselineApplied: boolean;
  readonly baselinePath: string | null;
  readonly suppressedCount: number;
  readonly metricRegressions: readonly MetricRegression[];
}

export interface FilterResult {
  readonly findings: readonly Finding[];          // post-filter
  readonly suppressedCount: number;
  readonly newInDiff: readonly Finding[];         // findings tagged with introducedInDiff: true
}

export function applyBaselineToOutcome(
  outcome: RunOutcome,
  baseline: BaselineSnapshot | undefined,
  options: { readonly baselinePath: string | null; readonly diffOnly: boolean },
): BaselineApplication;

export function applyBaseline(
  findings: readonly Finding[],
  baseline: BaselineSnapshot | undefined,
  changedFiles: readonly string[],
  diffOnly: boolean,
): FilterResult;

export function compareMetrics(
  current: CheckMetrics,
  baseline: Readonly<Record<string, MetricBaseline>>,
): readonly MetricRegression[];

export interface MetricRegression {
  readonly metric: string;
  readonly baselineValue: number;
  readonly currentValue: number;
  readonly direction: 'higher-is-better' | 'lower-is-better';
}
```

**Implementation notes:**
- A finding is "new" if its `fingerprint` is not in baseline's suppressed set.
- A finding is `introducedInDiff: true` if its `location.file` is in `changedFiles`.
- In `diffOnly: true` mode, drop findings outside `changedFiles` entirely. In trend mode, keep them but mark `introducedInDiff: false`.
- `compareMetrics` compares numeric metrics only and returns regressions only. Non-numeric `CheckMetrics` values are metadata and are ignored by metric baselines.
- `BaselineApplication` is structurally compatible with T1.4 `ReportInput`; it is what the CLI passes to `buildReport`.

**Acceptance criteria:**
- [ ] Findings in baseline are dropped (regardless of file change).
- [ ] Findings outside baseline survive.
- [ ] `introducedInDiff` correctly set.
- [ ] Metric direction respected (higher-is-better detects "current < baseline" as regression; lower-is-better the opposite).

**Tests required:**
- [ ] Each combination of {in-baseline, not-in-baseline} × {file-in-diff, file-not-in-diff} × {diffOnly: true, false}.
- [ ] Property test: applying baseline twice is idempotent.
- [ ] Metric comparison both directions.

---

### Phase 3 — Background jobs

> Independent from Phase 2. Can start as soon as Phase 1 is done.

#### T3.1 — Job spawner

**Depends on:** T0.2 (uses `Clock`, `FileSystem`), T1.5 (uses `Logger`)
**Blocks:** T3.2, T3.3
**Parallel-safe with:** T2.*

**Files:**
- `packages/core/src/jobs/spawner.ts`
- `packages/core/src/jobs/spawner.test.ts`
- `packages/core/src/jobs/types.ts`

**Public interface:**

```ts
export type JobStatus = 'running' | 'completed' | 'failed' | 'timed_out' | 'cancelled';

export interface JobMeta {
  readonly jobId: string;
  readonly jobDir: string;
  readonly resultPath: string;
  readonly pid: number;
  readonly startedAt: string;
  readonly status: JobStatus;
  readonly command: string;
  readonly args: readonly string[];
  readonly tier: Tier;
  readonly completedAt?: string;
  readonly exitCode?: number;
}

export interface SpawnOptions {
  readonly cwd: string;
  readonly tier: Tier;
  readonly env?: Readonly<Record<string, string>>;
}

export class JobSpawner {
  constructor(jobsDir: string, fs: FileSystem, clock: Clock);
  spawn(command: string, args: readonly string[], options: SpawnOptions): Promise<JobMeta>;
}
```

**Implementation notes:**
- `JobSpawner` is an explicit Node process/file I/O boundary. It may use `node:fs/promises.open` for `stdout.log` / `stderr.log` file descriptors and `child_process.spawn(command, args, { detached: true, stdio: ['ignore', stdoutFile.fd, stderrFile.fd] })`.
- After spawn, immediately call `child.unref()` so the parent can exit while child runs.
- Generate `jobId` via ULID (use `node:crypto.randomUUID` if no ULID lib; we don't add deps).
- Create `<jobsDir>/<jobId>/` with `meta.json`, `stdout.log`, `stderr.log`.
- `resultPath` is always `<jobsDir>/<jobId>/result.json`.
- The child writes `result.json` itself when done by receiving `--output=<resultPath>` from the background launcher.
- For now, `spawn` returns the initial `meta.json` content; status tracking is T3.2.

**Acceptance criteria:**
- [ ] Spawn returns immediately (under 100ms) regardless of command duration.
- [ ] Job directory created with `meta.json`.
- [ ] PID captured correctly.
- [ ] Parent process can exit while job continues (verified with integration test on a `sleep 5` command).

**Tests required:**
- [ ] Unit with fake child_process.
- [ ] Integration with real spawn of a known command (`node -e "setTimeout(() => process.exit(0), 100)"`).

---

#### T3.2 — Job status reader

**Depends on:** T3.1
**Blocks:** T3.3, T4.1 (status command)
**Parallel-safe with:** none in phase 3

**Files:**
- `packages/core/src/jobs/status.ts`
- `packages/core/src/jobs/status.test.ts`

**Public interface:**

```ts
export class JobReader {
  constructor(jobsDir: string, fs: FileSystem);
  read(jobId: string): Promise<JobMeta | undefined>;
  readResult(jobId: string): Promise<Report | undefined>;
  list(filter?: { status?: JobStatus }): Promise<readonly JobMeta[]>;
  readLogs(jobId: string, stream: 'stdout' | 'stderr', maxBytes?: number): Promise<string>;
}
```

**Implementation notes:**
- Detect "alive" jobs by checking if PID is running (`process.kill(pid, 0)` returns true). If `meta.status === 'running'` but PID is dead, mark as `failed` with `exitCode: -1`. Reasoning: process can die abruptly without writing meta.
- Log reading defaults to last 64 KiB to keep agent context manageable.

**Acceptance criteria:**
- [ ] Reads existing job meta correctly.
- [ ] Returns `undefined` for unknown jobId (does not throw).
- [ ] Detects orphaned jobs.
- [ ] Log truncation works.

**Tests required:**
- [ ] Stale job detection.
- [ ] Listing with and without filter.

---

#### T3.3 — Pending feedback queue

**Depends on:** T3.1, T3.2
**Blocks:** T4.1 (pending command)
**Parallel-safe with:** none in phase 3

**Files:**
- `packages/core/src/pending/pending.ts`
- `packages/core/src/pending/pending.test.ts`

**Public interface:**

```ts
export interface PendingItem {
  readonly id: string;
  readonly jobId: string;
  readonly createdAt: string;
  readonly tier: Tier;
  readonly summary: string;     // human-readable: "Mutation testing found 3 surviving mutants"
  readonly reportPath: string;  // path to result.json
  readonly acked: boolean;
}

export class PendingQueue {
  constructor(path: string, fs: FileSystem, clock: Clock);
  load(): Promise<readonly PendingItem[]>;
  enqueue(item: Omit<PendingItem, 'id' | 'createdAt' | 'acked'>): Promise<PendingItem>;
  ack(id: string): Promise<void>;
  prune(olderThan: number /* ms */): Promise<number>;
  unacked(): Promise<readonly PendingItem[]>;
}
```

**Implementation notes:**
- Storage: `.sentiness/pending-feedback.json`. Single local file, read/write atomic via temp file + `FileSystem.rename`.
- Concurrency: if two jobs try to enqueue simultaneously, use a lock directory (`.sentiness/pending-feedback.lock/`) created with `mkdir`. On contention, retry 5 times with exponential backoff, then fail loudly.
- `ack` does not delete — sets `acked: true`. `prune` removes acked items older than threshold.
- This file is **not** committed. It contains local job paths and exists to survive local agent sessions, not to synchronize across machines.

**Acceptance criteria:**
- [ ] Enqueue → load returns the item.
- [ ] Ack marks item.
- [ ] Concurrent enqueue does not lose items.
- [ ] Prune respects acked flag and age.

**Tests required:**
- [ ] Concurrency test: spawn N parallel enqueues, assert all present after.
- [ ] Round-trip.
- [ ] Prune semantics.

---

### Phase 4 — CLI

#### T4.1 — CLI commands

**Depends on:** T1.*, T2.*, T3.*
**Soft-depends on:** T6.* (the `install-skill` command dispatches to adapters; if T6 is not yet done, the command exists but reports "no adapters available"; once T6 is done, no change to T4.1 is needed because it imports the adapter registry lazily). T5.* for `doctor` check availability; with no checks installed, `doctor` reports an empty registry and a hint.
**Blocks:** T7.* (E2E)
**Parallel-safe with:** none in phase 4 (T4.2 and T4.3 extend the CLI command registry after T4.1)

**Files:**
- `packages/core/src/cli/index.ts`
- `packages/core/src/cli/commands/check.ts`
- `packages/core/src/cli/commands/status.ts`
- `packages/core/src/cli/commands/baseline.ts`
- `packages/core/src/cli/commands/pending.ts`
- `packages/core/src/cli/commands/doctor.ts`
- `packages/core/src/cli/commands/install-skill.ts`
- `packages/core/src/cli/commands/registry.ts`
- (each with co-located `.test.ts`)

**Commands:**

```
sentiness check [--tier=fast|standard|slow] [--trigger=<name>] [--diff] [--base=<ref>] [--background] [--compact] [--output=<path>]
sentiness init              # implemented by T4.2
sentiness status <jobId>
sentiness baseline init
sentiness baseline update [--metric=<name>]
sentiness baseline accept --fingerprint=<sha256> --reason=<text>
sentiness baseline prune
sentiness pending [--all]   # list unacked by default
sentiness pending ack <id>
sentiness install-skill --agent=<claude-code|codex|gemini|all>
sentiness install-hooks     # implemented by T4.3
sentiness doctor            # diagnose missing tools / config issues
```

**Notes on each command:**

- `check` — main command. If only `--trigger` is provided, resolve tier from config. If both `--tier` and `--trigger` are provided, reject mismatches. If neither is provided, use `standard`.
- `status <jobId>` — reads `meta.json` and (if completed) `result.json` from job directory.
- `baseline init` — runs all enabled checks across all tiers with no baseline applied, then writes `BaselineSnapshot` from the resulting findings + metrics. This can be implemented as one all-tiers helper or as three `runChecks` invocations merged into one `RunOutcome`.
- `baseline update [--metric=<name>]` — re-runs checks; if no `--metric` flag, updates all metrics that improved (ratchet). With `--metric`, updates only the named metric.
- `baseline accept` — re-runs checks, finds the current finding with the requested `--fingerprint`, and adds it to baseline. Requires non-empty `--reason`.
- `baseline prune` — runs `BaselineManager.prune` against current fingerprints.
- `install-skill --agent=<name>` — invokes the corresponding adapter (T6.*) to write managed section into the agent's instruction file. With `--agent=all`, runs all adapters.
- `install-hooks` — see T4.3.
- `doctor` — runs all installed checks' `detect()` and reports availability. Suggests install commands for missing tools (e.g., "stryker not found — `pnpm add -D @stryker-mutator/core`"). Verifies config validity. Does **not** run any check; this is read-only. **Soft-depends on Phase 5**: with no checks installed, `doctor` simply reports an empty registry and a hint to install check packages.

**Implementation notes:**
- Use `cac` for argument parsing.
- Each command is a function: `(args: ParsedArgs, deps: CommandDeps) => Promise<number>` returning exit code.
- `CommandDeps` is the dependency container: `{ fs, logger, clock, git, config, ... }`. Constructed once in `index.ts`.
- `check --background`: creates a job via `JobSpawner`, then spawns `node pathToCli check` with the original check arguments except `--background`, plus `--output=<job.resultPath>` and `--job-id=<jobId>`. Returns `{ jobId }` as JSON to stdout. `--job-id` is an internal hidden flag used so the child can update `meta.json` and enqueue pending feedback when it finishes.
- `check` (foreground): runs the full pipeline (config → registry → runner → baseline application → reporter), prints report JSON to stdout, writes the same JSON to `--output` when provided, and exits with code from `exitCodeFor(report)`.
- Command handlers write machine output through an injected stdout writer. They never use `console.log`.
- All errors caught at the top level → log to stderr → exit 3.

**Acceptance criteria:**
- [ ] Each command listed above implemented and tested.
- [ ] `--help` works for each.
- [ ] JSON to stdout, logs to stderr, never mixed.
- [ ] Exit codes per spec.

**Tests required:**
- [ ] Per-command unit tests with mocked deps.
- [ ] Smoke test that runs the CLI as a subprocess against `examples/demo-project/`.

---

#### T4.2 — Init wizard

**Depends on:** T1.1, T4.1
**Soft-depends on:** T6.* (wizard offers to install adapters; if not available, prints message "adapters not yet built; run `sentiness install-skill --agent=<name>` later")
**Blocks:** none
**Parallel-safe with:** none in phase 4 (updates CLI command registry)

**Files:**
- `packages/core/src/cli/commands/init.ts`
- `packages/core/src/cli/commands/init.test.ts`
- `packages/core/src/cli/commands/registry.ts`
- `packages/core/src/cli/wizard/prompts.ts`

**Implementation notes:**
- Use T1.7 for package manager and dependency detection. Detect test runner (`vitest`, `jest`), TypeScript, and agent files (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`) from package metadata and filesystem.
- For each detected gap, prompt: install / use existing path / skip.
- Generate `sentiness.config.js` reflecting answers.
- Generate `.sentiness/SKILL.md` from template.
- Create adapters per detected agent (delegate to `@sentiness/adapters`, see Phase 6).
- Prompt: "create initial baseline now? (recommended for existing projects)". If yes, call `sentiness baseline init` after.
- Use `node:readline/promises` for prompts. No third-party prompt lib.

**Acceptance criteria:**
- [ ] Detects all listed conditions correctly.
- [ ] Generates a config that loads without errors.
- [ ] Idempotent: re-running offers to update, not overwrite blindly.

**Tests required:**
- [ ] Each detection branch via mocked filesystem.
- [ ] Generated config validates against schema.

---

#### T4.3 — Hook installer

**Depends on:** T4.1
**Blocks:** none
**Parallel-safe with:** none in phase 4 (updates CLI command registry)

**Files:**
- `packages/core/src/cli/commands/install-hooks.ts`
- `packages/core/src/cli/commands/install-hooks.test.ts`
- `packages/core/src/cli/commands/registry.ts`

**Implementation notes:**
- Detect `husky`, `lefthook`, `simple-git-hooks` from `package.json`. If any present, install hook config there. If none, write to `.git/hooks/` directly with a warning that this won't survive `git clone` for new collaborators, and offer to install `simple-git-hooks` (no daemon, lightweight).
- Hook content: `pre-commit` → `sentiness check --tier=fast --trigger=pre-commit`; `pre-push` → `sentiness check --tier=slow --trigger=pre-push`.
- Idempotent: re-running updates hook scripts safely without duplicating entries.

**Acceptance criteria:**
- [ ] Each manager handled.
- [ ] Hooks executable on POSIX.
- [ ] Re-run is idempotent.

**Tests required:**
- [ ] Each manager branch.

---

### Phase 5 — Checks

> **Fully parallel-safe.** Each check is its own package; they touch disjoint files. Pick one and go.

Each check follows the same template, so I'll spell out one in detail (T5.1) and abbreviate the rest. **Read T5.1 carefully before starting any other Phase 5 task** — it establishes the conventions you must follow.

#### T5.1 — Check: Biome

**Depends on:** T0.2
**Parallel-safe with:** all other T5.*

**Files:**
- `packages/checks/biome/package.json`
- `packages/checks/biome/tsconfig.json`
- `packages/checks/biome/src/index.ts`
- `packages/checks/biome/src/biome.ts`
- `packages/checks/biome/src/biome.test.ts`
- `packages/checks/biome/src/normalize.ts`
- `packages/checks/biome/src/normalize.test.ts`
- `packages/checks/biome/README.md`

**Public interface:**

```ts
import type { Check } from '@sentiness/check-sdk';
const biomeCheck: Check = { /* ... */ };
export default biomeCheck;
```

**Implementation notes:**
- `detect`: run `ctx.process.execFile('biome', ['--version'], { cwd: ctx.cwd, signal: ctx.signal })`. If exit !== 0, return `{ available: false, reason: '...' }`.
- `run`: invoke `biome check --reporter=json --colors=off --max-diagnostics=none <changedFiles>`. Capture stdout. Parse with Zod schema (define a `BiomeOutputSchema` matching their format).
- `normalize`: map Biome diagnostics → `Finding[]`. Map their `severity` (`error|warning|info`) directly to ours. Use `${diagnostic.category}` as `ruleId`.
- For each finding, compute `fingerprint` using `computeFingerprint` from `@sentiness/check-sdk` with the `lineContent` read from the file (you'll need to read it; `ctx.fs.readFile` is available). Cache file reads if many findings hit the same file.
- Treat Biome's exit code 1 (warnings only) as success-with-findings, not error. Exit code >= 2 is `status: 'error'`.

**Acceptance criteria:**
- [ ] `detect` returns correct availability.
- [ ] Findings mapped with correct severity, location, fingerprint.
- [ ] `run` survives empty changed-files list (returns `{ status: 'ok', findings: [] }`).
- [ ] Errors from Biome are surfaced as `status: 'error'` with message.

**Tests required:**
- [ ] Unit test on `normalize` with fixture Biome output.
- [ ] `FakeProcessRunner` tests for `detect` and `run`.
- [ ] Property test: every finding has a non-empty 64-char fingerprint.

---

**Shared check-package template for T5.2 through T5.10:**

Unless a task says otherwise, each check package uses these files:
- `packages/checks/<slug>/package.json`
- `packages/checks/<slug>/tsconfig.json`
- `packages/checks/<slug>/src/index.ts`
- `packages/checks/<slug>/src/<slug>.ts`
- `packages/checks/<slug>/src/<slug>.test.ts`
- `packages/checks/<slug>/src/normalize.ts`
- `packages/checks/<slug>/src/normalize.test.ts`
- `packages/checks/<slug>/README.md`

Each package is named `@sentiness/check-<slug>`, exports one default `Check`, uses `ctx.process.execFile` for external commands, computes fingerprints with `@sentiness/check-sdk`, and uses `FakeProcessRunner` in tests. Minimum tests: `detect`, happy-path `run`, tool-error path, normalize fixture, and property test that every finding has a 64-character fingerprint.

#### T5.2 — Check: dependency-cruiser

Same pattern. Tool: `dependency-cruiser`. Categories: `architecture`. Particular notes:

- Parse the JSON output from `depcruise --output-type json`.
- Each violation maps to one `Finding`. `ruleId` = the dependency-cruiser rule name.
- Location: the *importing* file and line, not the imported one.
- Configure default rules: `no-circular`, `no-orphans`, plus user-defined in `.dependency-cruiser.cjs`.

#### T5.3 — Check: knip

Tool: `knip`. Category: `lint` (dead code is a kind of lint smell). Notes:

- Parse `knip --reporter json`.
- Each unused export, file, or dependency is one finding.
- Severity: `warning` for unused exports; `error` for unused dependencies (these affect security via supply chain).

#### T5.4 — Check: coverage

**No external tool.** Reads `coverage/coverage-final.json` (Istanbul format). Notes:

- Compute per-file line coverage. Compare against `thresholds.lineCoverage` (global) and `thresholds.diffLineCoverage` (changed files only).
- Each below-threshold file is one `Finding` with `ruleId: 'coverage-below-threshold'`.
- Skip the check entirely (`status: 'skipped'`, `skipReason: 'no coverage report found at <path>'`) if the file is missing — do not synthesize zero coverage.

#### T5.5 — Check: stryker

Tool: `stryker`. Category: `test-quality`. Notes:

- Run `stryker run --reporters json --incremental`. Do not pass `--since`; StrykerJS incremental mode uses its incremental report file, not a git ref flag.
- Parse the report file (path configured in `stryker.conf.js`, Sentiness reads it).
- Each surviving mutant is one `Finding`. `ruleId: 'stryker-survived'`. Severity: `warning` (configurable to `error`).
- Mutation score is added to `metrics`.

#### T5.6 — Check: osv-scanner

**Additional deps:** T1.7

Tool: `osv-scanner`. Category: `security`. Notes:

- Use T1.7 to find supported lockfiles (`package-lock.json`, `npm-shrinkwrap.json`, `pnpm-lock.yaml`, `yarn.lock`). If none exist, return `status: 'skipped'`.
- Run `osv-scanner scan --format json -L <lockfile>` once per lockfile and merge results.
- Each vulnerability is one `Finding`. `ruleId` = the OSV id (e.g., `GHSA-xxxx`).
- Severity from CVSS: critical → `error`, high → `error`, medium → `warning`, low → `info`.
- Location: the scanned lockfile path with `packageName` + `packageVersion`.
- Suggestion: `kind: 'upgrade'`, `command: '<pm> add <pkg>@<fixed-version>'` based on detected pm.

#### T5.7 — Check: lockfile-lint

**Additional deps:** T1.7

Tool: `lockfile-lint`. Category: `security`. Notes:

- Supports only npm `package-lock.json` / `npm-shrinkwrap.json` and Yarn `yarn.lock`, because lockfile-lint does not support `pnpm-lock.yaml`. For pnpm-only projects, return `status: 'skipped'` with a clear `skipReason`.
- Run `lockfile-lint --path <lockfile> --type <npm|yarn> --validate-https --validate-integrity --allowed-hosts npm yarn`.
- Each violation is one `Finding`.

#### T5.8 — Check: deps-diff

**Additional deps:** T1.6 (uses `GitProvider.fileContentAtRef`), T1.7

**No external tool.** Notes:

- Read `package.json` and detected lockfiles at `HEAD` and at `baseRef` via `GitProvider.fileContentAtRef`.
- Always diff direct dependency sections from `package.json` (`dependencies`, `devDependencies`, `optionalDependencies`). Diff transitive dependencies when the lockfile parser for that kind is implemented; if a lockfile kind is unsupported, set a metric `transitiveDiffAvailable: false` and do not fail the check.
- Each newly-added direct dependency produces one `Finding` with severity `info`, `ruleId: 'new-dependency'`. The point isn't to block — it's to surface. Agent's skill instructs it to summarize new deps in PR description.
- Each removed dependency: `info`, `ruleId: 'removed-dependency'`.
- Each version bump crossing a major: `warning`, `ruleId: 'major-version-bump'`.

#### T5.9 — Check: jscpd

Tool: `jscpd`. Category: `duplication`. Standard pattern.

#### T5.10 — Check: semgrep

Tool: `semgrep`. Category: `security`. Notes:

- Run `semgrep --config=p/javascript --json`.
- Default to ruleset `p/javascript`; user can override via check config.
- Each match is one `Finding`.

---

### Phase 6 — Adapters

> Each adapter writes a managed section into the agent's instruction file. The shared template content is its own task (T6.4) and **must be done first** within phase 6.

#### T6.4 — Skill template content

**Depends on:** T0.1, T0.2
**Blocks:** T6.1, T6.2, T6.3 (they all embed this content)
**Parallel-safe with:** none in phase 6

**Files:**
- `packages/adapters/package.json`
- `packages/adapters/src/index.ts`
- `packages/adapters/src/types.ts`
- `packages/adapters/src/skill-template.md`
- `packages/adapters/src/skill-template.test.ts`
- `packages/adapters/src/render.ts`

**Content the skill template must cover (sections, in order):**

1. **What Sentiness is** — one paragraph orienting the agent.
2. **When to run** — explicit rules: after each meaningful edit run `sentiness check --tier=fast --trigger=post-edit`; before declaring a task complete run `sentiness check --tier=standard --trigger=pre-done`; for slow checks dispatch `sentiness check --tier=slow --background` and poll `sentiness status <jobId>` with backoff.
3. **How to interpret the JSON** — explain `summary.blocking`, `agentInstructions.mustFix`, `agentInstructions.shouldFix`, severity hierarchy, `introducedInDiff`. Concrete example included.
4. **Pending feedback discipline** — at the start of every session, run `sentiness pending`. Treat unacked items as priority. After resolving, run `sentiness pending ack <id>`.
5. **Hard rules** — verbatim copy of §3 of CLAUDE.md from this project's instructions, adapted: never modify `sentiness.config.js`, `.sentiness/baseline.json`, thresholds, or `pending-feedback.json` to make a check pass; if blocked, fix the code or surface the conflict to the human.
6. **Polling protocol for background jobs** — exponential backoff starting at 5s, max 60s per attempt, max 10 attempts. After max attempts, declare the task done with explicit warning and let the deferred-feedback queue handle it next session.
7. **Adding dependencies** — if `addedDependencies` is non-empty in the report's `context`, mention each in the final task summary so the human can review.

**Public interface:**

```ts
export interface RenderOptions {
  readonly sentinessVersion: string;
  readonly configPath: string;
  readonly baselinePath: string;
  readonly pendingPath: string;
}

export type AgentName = 'claude-code' | 'codex' | 'gemini';

export interface InstallResult {
  readonly agent: AgentName;
  readonly targetPath: string;
  readonly changed: boolean;
}

export interface AgentAdapter {
  readonly agent: AgentName;
  readonly targetFile: 'CLAUDE.md' | 'AGENTS.md' | 'GEMINI.md';
  install(cwd: string, fs: FileSystem, options: RenderOptions): Promise<InstallResult>;
}

export function renderSkill(options: RenderOptions): string;
export function listAdapters(): readonly AgentAdapter[];
export function getAdapter(agent: AgentName): AgentAdapter | undefined;
export const TEMPLATE_VERSION = '1.0' as const;
```

**Implementation notes:**
- Template is a markdown file with `{{placeholders}}` for paths. `renderSkill` substitutes them.
- The rendered output is what gets embedded between `

<!-- sentiness:start -->
<!-- generated by @sentiness/adapters v1.1; do not edit between markers -->

## Sentiness Agent Instructions

Template version: 1.1
Sentiness version: 0.1.0
Config: `sentiness.config.json`
Baseline: `.sentiness/baseline.json`
Pending feedback: `.sentiness/pending-feedback.json`

### 1. What Sentiness Is

Sentiness is a local CLI quality gate for AI coding agents. It runs the repository's configured checks and returns one normalized JSON report so you can fix actionable issues without parsing tool-specific output.

### 2. When To Run

- After each meaningful edit, run `sentiness check --tier=fast --trigger=post-edit`.
- Before declaring a task complete, run `sentiness check --tier=standard --trigger=pre-done`.
- For slow checks, dispatch `sentiness check --tier=slow --background`, capture the returned `jobId`, and poll `sentiness status <jobId>` with the background polling protocol below.

### 3. How To Interpret The JSON

- `summary.blocking: true` means the task is not done. This is `true` when there are blocking findings **or** when a check failed due to a tooling error.
- `agentInstructions.mustFix` is the first queue to clear. It includes both finding-level errors and check-level tooling failures (e.g. a tool not installed).
- `agentInstructions.shouldFix` is important follow-up work, but it may not block completion unless the project rules say it does.
- Severity order is `error` above `warning` above `info`.
- `introducedInDiff: true` means the finding is tied to the current change and should be treated as higher priority than pre-existing work.
- `baseline.mode` describes how the baseline was used: `'suppress'` means findings in the baseline were filtered out; `'metrics-only'` means the baseline was loaded but findings were not filtered (trend mode); `'none'` means no baseline was loaded.

Example:

```json
{
  "summary": { "blocking": true },
  "agentInstructions": {
    "mustFix": ["[error] check 'biome' failed: biome not found", "Fix error in src/index.ts"],
    "shouldFix": ["Review coverage warning in src/parser.ts"]
  },
  "baseline": { "applied": true, "mode": "suppress", "suppressedFindings": 3 }
}
```

### 4. Pending Feedback Discipline

At the start of every session, run `sentiness pending`. Treat unacknowledged items as priority input before continuing new work. After resolving an item, run `sentiness pending ack <id>`.

### 5. Hard Rules

1. No `any`. Ever. If you reach for `any`, you have not understood the type. Use `unknown` and narrow, or define the type properly.
2. No unsafe `as` casts. Allowed: `as const`, branded-type constructors, and casts at trust boundaries. Boundary casts must be immediately followed by validation or an equivalent explicit narrowing function.
3. No global state. No singletons, no module-level mutable variables, and no `process.env` reads outside a single config-loading module.
4. No `console.log`. Use the injected logger or the project's logging abstraction. The CLI stdout stream is reserved for JSON reports.
5. No swallowed errors. Never write an empty `catch`. Either handle the error meaningfully, wrap and rethrow it with context, or let it propagate.
6. No partial implementations committed. A task is either done with tests, types, and docs, or it is not started. Do not leave `TODO` comments for behavior the task requires.
7. Never modify the active Sentiness config (`sentiness.config.json`), the baseline (`.sentiness/baseline.json`), thresholds, or pending feedback (`.sentiness/pending-feedback.json`) to make a check pass. The same rule applies if the repository uses `sentiness.config.js` or `sentiness.config.json`. If a threshold or baseline seems wrong, stop and surface that conflict to the human.
8. Never disable a test to make CI green. If a test is wrong, fix the test with a clear explanation. If a test is flaky, mark it as skipped only with a follow-up task.
9. One task per branch, one PR per task. If a task feels too big, stop and ask for it to be split.

### 6. Background Polling Protocol

When a slow check is running in the background, poll with exponential backoff: start at 5 seconds, double each time, cap each wait at 60 seconds, and stop after 10 attempts. If the job is still not complete, finish the task summary with an explicit warning and let the pending feedback queue handle it next session.

### 7. Adding Dependencies

If `context.addedDependencies` is non-empty in the report, mention each added dependency in the final task summary so the human can review it.
<!-- sentiness:end -->

` markers in CLAUDE.md / AGENTS.md / GEMINI.md.
- Each rendered output starts with a comment line `<!-- generated by @sentiness/adapters; do not edit between markers -->`.
- T6.1 through T6.3 register their adapters through `listAdapters()` / `getAdapter()` so `install-skill` can lazy-import `@sentiness/adapters` without knowing per-agent files.

**Acceptance criteria:**
- [ ] All 7 sections present and self-contained.
- [ ] Placeholders substituted correctly.
- [ ] `TEMPLATE_VERSION` bumped on any content change (lint rule enforces this — see test).

**Tests required:**
- [ ] Snapshot test on rendered output for known options.
- [ ] Test that unsubstituted `{{placeholders}}` cause a render failure.
- [ ] Lint rule: any change to `skill-template.md` requires bumping `TEMPLATE_VERSION` (a test that diffs git HEAD).

---

#### T6.1 — Adapter: Claude Code

**Depends on:** T0.1, T0.2 (uses `FileSystem`), T6.4
**Blocks:** T7.1 adapter installation tests
**Parallel-safe with:** T6.2, T6.3

**Files:**
- `packages/adapters/src/claude-code.ts`
- `packages/adapters/src/claude-code.test.ts`

**Behavior:**
- Generates / updates `CLAUDE.md` at the project root with a section `<!-- sentiness:start -->` ... `<!-- sentiness:end -->` containing the standard skill text.
- The standard skill text lives in `packages/adapters/src/skill-template.md` and is shared with other adapters.
- Idempotent: re-running replaces only the section between markers.

#### T6.2 — Adapter: Codex

**Depends on:** T0.1, T0.2, T6.4
**Blocks:** T7.1 adapter installation tests
**Parallel-safe with:** T6.1, T6.3

Same pattern as T6.1. Target file: `AGENTS.md`. Markers: `<!-- sentiness:start -->` ... `<!-- sentiness:end -->`. Codex respects this file via its hierarchical discovery.

#### T6.3 — Adapter: Gemini

**Depends on:** T0.1, T0.2, T6.4
**Blocks:** T7.1 adapter installation tests
**Parallel-safe with:** T6.1, T6.2

Same pattern. Target file: `GEMINI.md`. Markers identical.

---

### Phase 7 — Integration & polish

#### T7.1 — E2E test suite

**Depends on:** T4.1, T4.2, T4.3, and at least T5.1 + T5.4 + T5.6 (so the demo project triggers a representative mix of findings); T6.* for adapter installation tests.

**Files:**
- `packages/core/test/e2e/full-flow.test.ts`
- `examples/demo-project/` (small TS project with intentional issues)

**Behavior:**
- Spawn the built CLI binary against `examples/demo-project/`.
- Assert that the report matches expected findings.
- Assert exit code.
- Test `--background` round-trip: spawn → status check → result read.

#### T7.2 — Documentation

**Depends on:** everything.

**Files:**
- `README.md` (project overview)
- `docs/getting-started.md`
- `docs/writing-a-check.md`
- `docs/baseline-strategy.md`
- `docs/agent-skill.md`

---

## 12. Definition of Done (per task)

A task is done when **all** of the following are true:

- [ ] All files listed under "Files" exist.
- [ ] All public interfaces match the documented signatures exactly.
- [ ] All acceptance criteria checked.
- [ ] All required tests written and passing.
- [ ] `pnpm --filter <package> typecheck` passes with no errors and no warnings.
- [ ] `pnpm --filter <package> lint` passes.
- [ ] `pnpm --filter <package> test` passes with coverage above thresholds.
- [ ] No `// TODO` comments for behavior the task required.
- [ ] No `any`, no unjustified `as`, no `console.log`, no swallowed errors.
- [ ] README in the package explains its purpose in one paragraph.
- [ ] `docs/progress.md` updated to mark task complete.
- [ ] PR description references the task ID and lists deviations from spec (if any) with justification.

## 13. When you are stuck

If something is genuinely ambiguous, **stop and ask** in your final message rather than guessing. Specifically:

- If a public interface seems wrong or insufficient — flag it. Don't quietly extend it.
- If a task seems too large — flag it. Don't merge two tasks.
- If you find a bug in an earlier task while doing yours — open a follow-up task in `docs/progress.md`, do not silently fix it in your branch (it muddies review).
- If two tasks have conflicting expectations — flag it. The doc has bugs; don't paper over them.

The cost of asking is one round-trip with the human. The cost of guessing wrong is days of rework and review confusion. Always ask.

---

## Appendix A — Report JSON schema (canonical)

The full Zod-derived shape lives in `packages/core/src/schema/report.ts`. The high-level structure (this is the contract; the schema enforces it):

```ts
{
  schemaVersion: '1.0',
  sentinessVersion: string,
  runId: string,
  startedAt: ISO8601,
  completedAt: ISO8601,
  durationMs: number,

  context: {
    cwd: string,
    tier: Tier,
    trigger: string | null,
    mode: 'diff' | 'trend' | 'full',
    baseRef: string | null,
    headRef: string | null,
    changedFiles: readonly string[],
    addedDependencies: readonly string[],
    removedDependencies: readonly string[],
  },

  summary: {
    status: 'ok' | 'violations' | 'error',
    totals: { error: number, warning: number, info: number },
    newInDiff: { error: number, warning: number, info: number },
    blocking: boolean,
    topIssues: readonly string[],
    checksRun: number,
    checksSkipped: number,
    checksErrored: number,
  },

  checks: readonly {
    id: CheckId,
    category: Category,   // 'platform' when the runner itself generated the result (load failure)
    status: CheckStatus,
    durationMs: number,
    metrics?: CheckMetrics,
    findings: readonly Finding[],
    skipReason?: string,
    errorMessage?: string,
    truncated?: { total: number, shown: number },
  }[],

  trend: { available: boolean, regressions?: readonly ReportMetricRegression[], reason?: string },
  baseline: { applied: boolean, path: string, suppressedFindings: number },
  agentInstructions: {
    blocking: boolean,
    mustFix: readonly string[],
    shouldFix: readonly string[],
    informational: readonly string[],
  },
}
```

## Appendix B — Glossary

- **Check**: a plugin that runs one tool and produces findings.
- **Finding**: a single violation reported by a check, with location, severity, fingerprint.
- **Fingerprint**: SHA-256 hash uniquely identifying a finding across runs.
- **Baseline**: snapshot of suppressed findings + metric thresholds.
- **Tier**: speed bucket of a check (fast / standard / slow).
- **Trigger**: event that runs a tier (post-edit / pre-done / pre-commit / pre-push / manual).
- **Diff mode**: only new findings (relative to baseline) are reported.
- **Trend mode**: metric regressions on the whole codebase are reported.
- **Pending feedback**: results of background jobs, queued for the next agent session.

## Appendix C — Default paths

These are the canonical filesystem paths Sentiness uses. Defined here so every task references the same constants.

| Path | Purpose | Committed to repo? |
|---|---|---|
| `sentiness.config.js` (or `.json`) | User config | Yes |
| `.sentiness/baseline.json` | Baseline snapshot | Yes |
| `.sentiness/pending-feedback.json` | Local background job queue | No |
| `.sentiness/jobs/<jobId>/` | Per-job logs and results | **No** (gitignored) |
| `.sentiness/cache/` | Plugin caches (e.g., Stryker incremental) | No |
| `coverage/coverage-final.json` | Istanbul coverage report (read by `coverage` check) | No |

The `.sentiness/` directory is created by `sentiness init`. The `init` command writes the appropriate `.gitignore` entries automatically.

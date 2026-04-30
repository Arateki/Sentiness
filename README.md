# Sentiness

Sentiness is a Node.js CLI that runs code-quality checks and emits one normalized JSON report
for AI coding agents and CI. It is baseline-aware, tier-based, and designed so agents can ask one
question before declaring work complete: what is still wrong in this codebase?

Current repository status: the core CLI, baseline workflows, background jobs, agent instruction
adapters, and the Biome, Knip, Coverage, Stryker, dependency-cruiser, deps-diff, lockfile-lint,
OSV Scanner, jscpd, and Semgrep checks are implemented and tested locally. Commands below
distinguish between this checkout and a target project using an installed `sentiness` binary.

## Quick Start In This Checkout

```sh
pnpm install
pnpm build
pnpm sentiness doctor
pnpm sentiness check --tier=fast --compact
```

`doctor` may return a non-zero exit code if optional external tools such as `knip`, Stryker,
dependency-cruiser, lockfile-lint, OSV Scanner, jscpd, or Semgrep are not installed in this local
checkout. That means Sentiness is running and reporting the missing tooling; use the JSON/text output
to decide which package to install for the checks you enabled.

## Add Sentiness To A Project

After the Sentiness CLI is available on the target project's package-manager path:

```sh
sentiness init --yes --checks=biome --no-baseline
sentiness doctor
sentiness baseline init
sentiness check --tier=fast --compact
sentiness install-hooks --push
sentiness install-skill --agent=codex
```

`init` writes `sentiness.config.json`, creates `.sentiness/` runtime directories, and updates
`.gitignore` for local job/cache files. `baseline init` records existing findings so adoption does
not block on pre-existing debt.

## What The CLI Provides

| Command | Purpose |
|---|---|
| `sentiness init` | Create config and local runtime paths. Supports `--yes`, `--checks=<ids>`, and `--no-baseline`. |
| `sentiness doctor` | Load configured checks, run each check's `detect()`, and report missing tools. |
| `sentiness check` | Run checks for a tier or trigger and print the normalized report JSON. |
| `sentiness check --background` | Spawn a background job, then inspect it with `status` and `pending`. |
| `sentiness baseline init` | Create the initial committed baseline snapshot. |
| `sentiness baseline update` | Ratchet metric baselines when metrics improve. |
| `sentiness baseline accept` | Add one current finding to the baseline with an explicit reason. |
| `sentiness baseline prune` | Remove baseline entries for findings that no longer exist. |
| `sentiness install-hooks` | Install managed pre-commit and optional pre-push hooks. |
| `sentiness install-skill` | Install managed Sentiness instructions for Claude Code, Codex, Gemini, or all. |

## Configuration

Sentiness loads `sentiness.config.js` first, then `sentiness.config.json`.

```json
{
  "schemaVersion": "1.0",
  "checks": {
    "biome": { "enabled": true, "tier": "fast" },
    "knip": { "enabled": true, "tier": "standard" },
    "deps-diff": { "enabled": true, "tier": "fast" },
    "dependency-cruiser": { "enabled": true, "tier": "standard" },
    "lockfile-lint": { "enabled": true, "tier": "standard" },
    "jscpd": { "enabled": true, "tier": "standard" },
    "coverage": {
      "enabled": true,
      "tier": "slow",
      "thresholds": { "lineCoverage": 85 }
    },
    "stryker": { "enabled": true, "tier": "slow" },
    "osv-scanner": { "enabled": true, "tier": "slow" },
    "semgrep": { "enabled": true, "tier": "slow" }
  },
  "baseline": { "path": ".sentiness/baseline.json" },
  "pending": { "path": ".sentiness/pending-feedback.json" },
  "reporting": {
    "compact": false,
    "omitOk": true,
    "warningsAreErrors": false
  },
  "agents": ["codex"]
}
```

Configured check IDs resolve to packages named `@sentiness/check-<id>`.

## Report Contract

The runtime source of truth is `packages/core/src/schema/report.ts`. The committed public JSON
Schema artifact is generated at `packages/core/schema/report.schema.json`.

Reports include:

- `context`: cwd, tier, trigger, mode, base/head refs, changed files, dependency deltas.
- `summary`: status, severity totals, blocking state, top issues, and check counts.
- `checks`: normalized per-check findings, metrics, skip reasons, and tool errors.
- `trend`: metric regression information when a baseline exists.
- `baseline`: whether the baseline was applied and how many findings were suppressed.
- `agentInstructions`: concise must-fix, should-fix, and informational guidance for agents.

Exit codes are `0` for non-blocking reports, `1` for blocking errors, `2` for blocking warnings,
and `3` for platform or check execution errors.

## Documentation

- [Getting started](docs/getting-started.md)
- [Writing a check](docs/writing-a-check.md)
- [Baseline strategy](docs/baseline-strategy.md)
- [Agent skill integration](docs/agent-skill.md)

## Development

```sh
pnpm build
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm lint
pnpm --filter @sentiness/core generate-schema
pnpm check:release-packages
```

`pnpm test:e2e` builds the workspace first and then runs the built CLI against
`examples/demo-project`.

`pnpm check:release-packages` rebuilds the workspace and verifies that publishable packages expose
`dist` type/runtime entries and do not include source, tests, or coverage artifacts in their release
allowlist.

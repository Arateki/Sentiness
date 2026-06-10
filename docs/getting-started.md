# Getting Started

Sentiness is a CLI-first tool. It runs configured checks, applies a baseline, and prints a JSON
report that an AI agent or CI job can consume without parsing tool-specific output.

## Prerequisites

- Node.js `>=20.10`
- pnpm for this workspace
- Git in the target project if you want baseline commit metadata, diff mode, or hooks
- The external tools for enabled checks, for example Biome, Knip, Stryker, dependency-cruiser,
  lockfile-lint, OSV Scanner, jscpd, or Semgrep

Use the local checkout commands for development and bare `sentiness` commands in projects where the
binary is already available.

## Run The Local Checkout

```sh
pnpm install
pnpm build
pnpm sentiness doctor
pnpm sentiness check --tier=fast --compact
```

The repository config enables Biome, Knip, Coverage, and Stryker. Additional Phase H checks are
available for target projects and can be enabled by ID. If an external binary is missing, `doctor`
exits non-zero and reports the missing check with an install suggestion. That is expected when a
local machine has not installed every optional tool.

## Initialize A Target Project

`sentiness init` is the one-command onboarding path. Interactively it detects your stack (package
manager, TypeScript, test runner, Playwright config, existing agent instruction files) and walks
you through everything with detection-driven defaults:

- which checks to enable (recommended ones pre-selected);
- installing the missing `@sentiness/check-*` packages and npm-installable tools through your
  package manager, after showing you the exact command (osv-scanner and semgrep are not npm
  packages; their install hints are printed instead);
- installing AI agent instructions for the agents it detected (`.claude/`/`CLAUDE.md`,
  `AGENTS.md`, `GEMINI.md`);
- installing git hooks (pre-commit fast checks, pre-push slow checks);
- creating the initial baseline.

Non-interactively, each step has a flag:

```sh
sentiness init --yes --checks=biome --no-baseline
sentiness init --yes --checks=biome,knip --install --skill=claude-code-skill --hooks
```

The first form only writes config and runtime paths (nothing is installed without consent). For a
project with existing issues, initialize the baseline after confirming `doctor` is clean for the
checks you want:

```sh
sentiness doctor
sentiness baseline init
```

Some checks need a tool-level config file (for example `stryker.conf.json`) before they can run.
`doctor` reports those gaps with a `config.configured: false` block plus a `configSuggestion`.
Generate the default template with:

```sh
sentiness init-config --check=stryker
```

Re-running `init-config` is idempotent. Use `--force` only when you intentionally want to overwrite
your existing tool config.

`init` creates:

- `sentiness.config.json`
- `.sentiness/jobs/`
- `.sentiness/cache/`
- `.gitignore` entries for local Sentiness runtime files

The baseline file defaults to `.sentiness/baseline.json`. It is intentionally not ignored because it
is the committed adoption contract for the project.

## Minimal Config

```json
{
  "schemaVersion": "1.0",
  "checks": {
    "biome": {
      "enabled": true,
      "tier": "fast"
    }
  },
  "baseline": {
    "path": ".sentiness/baseline.json"
  },
  "pending": {
    "path": ".sentiness/pending-feedback.json"
  }
}
```

Sentiness resolves enabled check IDs by loading packages named `@sentiness/check-<id>` from the
target project. For the config above, it loads `@sentiness/check-biome`.

Implemented check IDs in this checkout:

- `biome`
- `knip`
- `coverage`
- `stryker`
- `deps-diff`
- `dependency-cruiser`
- `lockfile-lint`
- `osv-scanner`
- `jscpd`
- `semgrep`

## Daily Workflow

Run fast checks after edits:

```sh
sentiness check --tier=fast --compact
```

Run checks by trigger when integrating with hooks or agents:

```sh
sentiness check --trigger=pre-commit
sentiness check --trigger=pre-done
sentiness check --trigger=pre-push
```

Run file-level diff filtering:

```sh
sentiness check --tier=fast --diff --base=main
```

Run slow checks in the background:

```sh
sentiness check --tier=slow --background
sentiness status <jobId>
sentiness pending --all
sentiness pending ack <pendingId>
```

## Install Local Automation

Install managed Git hooks:

```sh
sentiness install-hooks --push
```

Sentiness detects Husky, Lefthook, or simple-git-hooks when present. If no hook manager is detected,
it writes directly to `.git/hooks`, which is useful locally but is not shared after clone.

Install managed AI-agent instructions:

```sh
sentiness install-skill --agent=codex
sentiness install-skill --agent=claude-code
sentiness install-skill --agent=gemini
sentiness install-skill --agent=all
```

The command is idempotent and replaces only the Sentiness managed section.

## Exit Codes

| Code | Meaning |
|---|---|
| `0` | No blocking issues. Warnings may still appear when `warningsAreErrors` is false. |
| `1` | Blocking errors were found. |
| `2` | Blocking warnings were found because `warningsAreErrors` is true. |
| `3` | A check or platform error occurred. Treat this as an invalid verification run. |

Agents and CI should parse the JSON report as the source of truth, not only the exit code.

## Troubleshooting

Run `sentiness doctor` first when a check does not execute. The command loads configured check
packages and calls each check's `detect()` method, so it catches both missing Sentiness packages and
missing backing tools.

If `sentiness check --background` returns a job ID but no pending item appears, inspect
`sentiness status <jobId>`. Pending feedback is only queued when the background run finishes with a
non-zero report exit code.

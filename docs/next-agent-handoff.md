# Next Agent Handoff

Date: 2026-06-09

## How to start

1. Read `CLAUDE.md` in full (mandatory — it is the canonical spec and rulebook).
2. Read `docs/progress.md` for what is implemented and the prioritized next steps.
3. Run the "How to resume safely" command block at the end of `docs/progress.md` before touching
   code.

## Current Status

- Phases A–K are done and committed. The CLI is usable end-to-end with 10 check packages, baseline
  workflows, background jobs, hooks, the init wizard, `doctor` config validation, `init-config`,
  and four agent adapters (`claude-code`, `claude-code-skill`, `codex`, `gemini`).
- Phase K added the `claude-code-skill` adapter: a discoverable Claude Code skill written to
  `.claude/skills/sentiness/SKILL.md` (whole-file, YAML frontmatter, no managed markers,
  idempotent). The generated skill file is committed in this repo as dogfooding.
- A dogfooding incident had corrupted `CLAUDE.md` (commit `00cce0a`): `install-skill
  --agent=claude-code` replaced content between marker text that the spec quoted inline. Fixed on
  2026-06-09 — see `docs/progress.md` ("Dogfooding incident"). Rule going forward: never write the
  literal managed-marker comments inside any file the adapters may target.

## Validation Run (2026-06-09)

```sh
pnpm typecheck                  # clean
pnpm lint                       # 173 files, clean
pnpm test                       # all packages green; core 135 tests / 24 files
pnpm test:e2e                   # 13/13 after full build
pnpm sentiness check --tier=fast --compact   # summary.status: ok
```

## Recommended Next Steps

See the numbered list at the end of `docs/progress.md`. In priority order:

The backlog is empty. T5.11 (`@sentiness/check-playwright`) and T6.6 (skill template
"Visual Verification" section, TEMPLATE_VERSION 1.2) are implemented and committed; the
dogfooding skill at `.claude/skills/sentiness/SKILL.md` is regenerated. New work should start
from a fresh task spec in `CLAUDE.md` (per §13, ask the human rather than inventing scope).

Done after this handoff was first written: `config.agents` accepts `'claude-code-skill'`
(2026-06-09); the managed-section writer only matches full-line markers, closing the root cause
of the CLAUDE.md corruption incident (2026-06-10); `deps-diff` now parses `pnpm-lock.yaml`
(v5/v6/v9) and `yarn.lock` (classic/berry) for transitive diffs (2026-06-10); diff-mode policy
decided and implemented — `security`/`platform` findings are never dropped by `--diff`
(2026-06-10); `dependency-cruiser` declares `configFiles`/`defaultConfig` with the
doctor → init-config cycle covered by E2E, while jscpd/semgrep deliberately stay config-file-free
(2026-06-10); `NodeProcessRunner` prepends the cwd's `node_modules/.bin` chain to the child PATH,
so external-tool checks work when the CLI is invoked directly (2026-06-10).

Each item is one task: one branch, one PR, per `CLAUDE.md` §3.9.

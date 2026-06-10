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

1. pnpm/Yarn lockfile parsers for `@sentiness/check-deps-diff`.
2. Hunk-level diff policy for findings without line locations.
3. `configFiles`/`defaultConfig` for dependency-cruiser, jscpd, and semgrep, with E2E coverage.
4. Resolve project-local tool binaries (`node_modules/.bin`) in `detect`/`run`.

Done after this handoff was first written: `config.agents` accepts `'claude-code-skill'`
(2026-06-09); the managed-section writer only matches full-line markers, closing the root cause
of the CLAUDE.md corruption incident (2026-06-10).

Each item is one task: one branch, one PR, per `CLAUDE.md` §3.9.

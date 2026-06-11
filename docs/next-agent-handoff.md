# Next Agent Handoff

Date: 2026-06-11

## How to start

1. Read `CLAUDE.md` in full (mandatory — it is the canonical spec and rulebook).
2. Read `docs/progress.md` for what is implemented and the prioritized next steps.
3. Run the "How to resume safely" command block at the end of `docs/progress.md` before touching
   code.

## Current Status (audited 2026-06-11)

- **Published on npm**: all 14 public packages live under the `@sentiness` scope
  (`@sentiness/core` at **0.1.1**, the other 13 at 0.1.0; npm org owned by the `arateki.co`
  account). Published runtime is byte-equivalent to `main` HEAD — the only commit touching
  `packages/` since the 0.1.1 publish changed a test file, which is excluded from tarballs.
- **GitHub**: `git@github.com:Arateki/Sentiness.git`, branch `main`, CI on push/PR. Two CI fixes
  landed after the first runs: (1) `pnpm build` now runs before typecheck/tests because workspace
  packages resolve each other through `dist/` (clean runners have no dist); (2) the install-skill
  test derives its expected version from `SENTINESS_VERSION` instead of hardcoding `0.1.0`.
- **End-to-end verified from the public registry**: a clean temp project with
  `pnpm add -D @sentiness/core` + `sentiness init --yes --checks=biome --no-baseline --install
  --skill=claude-code-skill --hooks` installs packages, the skill, and hooks; plain `--yes`
  installs nothing (the 0.1.0 regression — cac defaulting `--no-X`-registered flags to true — is
  fixed in 0.1.1 and guarded by E2E).
- 11 checks, 4 agent adapters, one-command onboarding (T4.4), baseline workflows, background jobs,
  hooks, doctor config validation, and the Playwright visual-feedback check (T5.11/T6.6) are all
  done. CLI usable end-to-end.

## Validation Run (2026-06-11, clean-runner simulation: all dist/ deleted first)

```sh
pnpm build                       # 15 packages
pnpm lint                        # 188 files, clean
pnpm typecheck                   # 15 packages
pnpm test                        # 15 packages green (core: 162 tests)
pnpm test:e2e                    # 14/14
pnpm check:release-packages      # 14 packages
pnpm sentiness check --tier=fast --compact          # ok
pnpm sentiness check --tier=standard --trigger=pre-done   # ok
```

## Release process

Bump version in the package → `pnpm build` → commit →
`pnpm --filter <pkg> publish --access public --publish-branch main`. npm auth currently uses a
granular token in the human's `~/.npmrc`.

## Recommended Next Steps

1. **`release.yml` (tag-triggered publish workflow)** — run the full gate sequence, then
   `pnpm -r publish --provenance` using npm Trusted Publishing (OIDC, no stored token). The human
   must configure each package's trusted publisher on npmjs.com. This also retires the granular
   token. Approach already discussed and agreed with the human on 2026-06-10.
2. **Generated config vs. Biome formatting** — `sentiness init` writes `sentiness.config.json`
   via `JSON.stringify(..., 2)`, which expands short arrays one-element-per-line; Biome's default
   formatter compacts them, so a fresh biome-enabled project starts with a format finding on the
   file Sentiness itself generated. Fix by emitting Biome-compatible formatting (or running the
   detected formatter on generated files).
3. **Security follow-up for the human**: the npm granular token was pasted into the working chat
   transcript on 2026-06-10 and should be revoked and regenerated.

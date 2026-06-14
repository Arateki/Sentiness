# Next Agent Handoff

Date: 2026-06-11

## How to start

1. Read `CLAUDE.md` in full (mandatory — it is the canonical spec and rulebook).
2. Read `docs/progress.md` for what is implemented and the prioritized next steps.
3. Run the "How to resume safely" command block at the end of `docs/progress.md` before touching
   code.

## Current Status (audited 2026-06-11)

- **Published on npm**: all 15 public packages live under the `@sentiness` scope. Latest as of
  2026-06-14 (published from CI via OIDC, see "Release process"): `@sentiness/core` **0.1.4**,
  `check-sdk` **0.2.0**, `check-knip` **0.2.0**, `adapters` **0.1.2**, the other 11 checks **0.1.1**.
  npm org owned by the `arateki.co` account.
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

## Release process (automated since 2026-06-14)

Releases run through **Changesets + GitHub Actions OIDC Trusted Publishing** — no stored npm token.

1. A PR that changes a publishable package adds a `.changeset/*.md` (run `pnpm changeset`).
2. On push to `main`, `.github/workflows/release.yml` runs the gate sequence and the
   `changesets/action`, which opens/updates a **"Version Packages"** PR while changesets are pending.
3. Merging that PR bumps versions + writes CHANGELOGs; the next run publishes the changed packages.

Publishing does **not** use `changeset publish` directly: pnpm has no OIDC exchange (`ENEEDAUTH`)
and `npm publish` cannot resolve `workspace:*`. `scripts/publish-oidc.mjs` bridges them — `pnpm pack`
(resolves `workspace:*`) + `npm publish --provenance` (npm ≥ 11.5.1 does the OIDC exchange), creating
each git tag for the Changesets action to push. It is idempotent (skips versions already on npm). See
the `sentiness-release-pipeline` memory for the full rationale and the gotchas (no `registry-url` in
setup-node; bumping `check-sdk` cascades to all 15 packages via `workspace:*`).

## Recommended Next Steps

1. **`release.yml` (Changesets + OIDC publish)** — *done 2026-06-14*. The pipeline is live: all 15
   public packages published from CI via OIDC Trusted Publishing with provenance — `@sentiness/core`
   **0.1.4**, `check-sdk` **0.2.0**, `check-knip` **0.2.0**, `adapters` **0.1.2**, the other 11
   checks **0.1.1** (the `check-sdk` minor cascaded a patch bump to every dependent). Git tags and
   GitHub Releases created for all 15. Each package has a Trusted Publisher configured on npmjs.com
   (org `Arateki`, repo `Sentiness`, workflow `release.yml`).
2. **Generated config vs. Biome formatting** — *done 2026-06-11 (GitHub issue #2)*: after the
   package-install step, `init` now runs `biome format --write sentiness.config.json` through the
   injected `ProcessRunner`, so the generated config always matches the project's active formatter
   style. Formatter absence or refusal is non-fatal (logged at debug level).
3. **Security follow-up for the human** — *done 2026-06-14*: the previously-exposed npm granular
   token was revoked; CI now publishes via OIDC, so no long-lived npm token is stored anywhere.

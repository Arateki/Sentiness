---
"@sentiness/check-sdk": minor
"@sentiness/check-knip": minor
"@sentiness/core": patch
---

knip: suppress the Sentiness-stack false positives and scaffold a context-aware `knip.json` (#7)

- `check-knip` now drops dependency findings for the `@sentiness/*` scope and the wrapped tool
  binaries at runtime (issue #7 option 1), and additionally declares `configFiles`,
  `configOptional`, and a dynamic `defaultConfig(ctx)` that scaffolds a minimal `knip.json` seeded
  with the enabled checks' tool binaries (option 2). Both ignore lists derive from one
  `CHECK_TOOL_DEPENDENCIES` map.
- `@sentiness/check-sdk`: `defaultConfig` now receives a `DefaultConfigContext { enabledCheckIds }`,
  and a new additive `Check.configOptional` flag marks checks whose config file is optional. Existing
  `() => …` implementations remain assignable to the new signature (no breaking change).
- `@sentiness/core`: `doctor` reports `config.optional` and no longer fails when an *optional* config
  file is absent (a *required* one still fails); `init-config` builds the `enabledCheckIds` context
  and passes it to `defaultConfig`.

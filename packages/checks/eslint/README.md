# @sentiness/check-eslint

Runs the target project's own ESLint setup (`eslint --format json`, standard tier) through the
Sentiness check interface and normalizes diagnostics into Sentiness findings. It exists for
ecosystems Biome cannot fully lint yet — most notably Vue SFCs via `eslint-plugin-vue` — so those
files participate in the Sentiness quality gate (`summary.blocking` / `agentInstructions.mustFix`)
instead of living outside it.

ESLint severity 2 maps to `error` and severity 1 to `warning`; fatal messages (parsing errors)
become `parse-error` findings, and operational notices without a rule id ("File ignored
because…") are dropped. Absolute file paths are relativized against the project root and
fingerprints are computed from check id, rule id, relative path, and source line content.

The check declares flat-config `configFiles` (`eslint.config.js`/`.mjs`/`.cjs`/`.ts`/`.mts`/
`.cts`) with no default template (a useful ESLint config is project-specific) and skips
gracefully when none exists. In diff mode it lints only the changed files; otherwise it lints
`targets` from the check config (default `['.']`), so it can run alongside `check-biome` on
disjoint file sets. Extra CLI flags can be passed via `extraArgs`. ESLint exit code 1 with
parseable JSON is success-with-findings; exit codes >= 2 surface as check errors.

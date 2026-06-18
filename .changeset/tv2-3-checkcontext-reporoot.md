---
"@sentiness/check-sdk": minor
---

Add `CheckContext.repoRoot` so checks can reach the repository root independently
of `cwd`. In a polyglot monorepo `cwd` is the zone root (e.g. `crates/engine`)
while `repoRoot` is the repository root, for the rare check that needs repo-level
context. Additive and backward-compatible for the documented consumer pattern
(checks read the context); single-zone runs set `repoRoot === cwd`.

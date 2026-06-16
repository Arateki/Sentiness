---
"@sentiness/core": patch
---

`sentiness init` now generates a v2 config instead of the removed schema 1.0
shape: `schemaVersion: '2.0'`, an `engine` pin, and each enabled check written as
a catalog entry (`{ version, tier }`). The legacy `<pm> add -D` step is gone —
init resolves the catalog through `sentiness install` (with consent), which
writes `sentiness.lock` and warms the cache. For polyglot monorepos, init detects
per-directory ecosystems (`package.json` → node, `Cargo.toml` → rust, `go.mod` →
go) and writes an explicit `zones[]` block; single-ecosystem projects omit it.

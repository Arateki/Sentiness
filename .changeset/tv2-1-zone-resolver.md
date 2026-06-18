---
"@sentiness/core": patch
---

Add the internal `resolveZones` zone resolver (`packages/core/src/zones`), the
foundation for Phase V2 per-zone execution. It maps a v2 config's `zones` into
rooted, option-merged placements (`absRoot = join(repoRoot, path)`; catalog
options deep-merged with per-zone overrides). No public API change — the module is
internal to `core` and not re-exported from `index.ts`.

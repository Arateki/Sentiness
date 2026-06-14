# @sentiness/check-knip

Runs Knip through the Sentiness check interface and normalizes unused files, exports, dependencies,
and related project-structure findings into stable Sentiness fingerprints for agent consumption.

## Ignored dependencies

Knip's import-based analysis cannot see dependencies that are run by dynamic dispatch or as a
binary, so it misreports the Sentiness stack itself as unused. This check therefore drops, by
default, unused-dependency findings for the `@sentiness/*` scope and the external tool binaries the
Sentiness checks wrap (`eslint`, `@biomejs/biome`, `knip`, `@playwright/test`, `jscpd`, `semgrep`,
`osv-scanner`, `dependency-cruiser`, `lockfile-lint`, `@stryker-mutator/core`). Genuinely unused
dependencies are still reported.

Add project-specific patterns (matched as anchored regular expressions against the dependency name)
via the check config in `sentiness.config.json`:

```json
{
  "checks": {
    "knip": { "enabled": true, "ignoreDependencies": ["vuetify", "@mdi/.*"] }
  }
}
```

### Scaffolding `knip.json`

The runtime filter only applies inside `sentiness check`. If you also run `knip` directly (IDE,
`lint-staged`, a separate CI job), generate a `knip.json` so those invocations are clean too:

```sh
sentiness init-config --check=knip
```

This writes a `knip.json` whose `ignoreDependencies` covers the `@sentiness/*` scope plus the tool
binaries of the checks you have enabled. Because the runtime filter keeps the Sentiness gate green
without it, this config is optional: `sentiness doctor` reports whether the file exists but never
fails just because it is missing.

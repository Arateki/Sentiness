# @sentiness/check-dependency-cruiser

Runs `depcruise --output-type json` and normalizes dependency-cruiser rule violations as
Sentiness architecture findings. Project `.dependency-cruiser.*` config is honored by the tool; set
`checks["dependency-cruiser"].configPath` to pass a specific config file.

Findings point at the importing file and include `startLine` when dependency-cruiser reports one.

The check declares `configFiles` (`.dependency-cruiser.cjs`/`.js`/`.mjs`/`.json`), so `sentiness
doctor` flags a missing rule config and `sentiness init-config --check=dependency-cruiser` writes a
default `.dependency-cruiser.cjs` with the `no-circular` and `no-orphans` rules.

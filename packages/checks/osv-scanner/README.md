# @sentiness/check-osv-scanner

Runs `osv-scanner scan --format json -L <lockfile>` for supported JavaScript lockfiles and maps OSV
vulnerabilities to Sentiness security findings.

Supported lockfiles: `package-lock.json`, `npm-shrinkwrap.json`, `pnpm-lock.yaml`, and `yarn.lock`.
Findings point at the scanned lockfile and include `packageName`/`packageVersion`.

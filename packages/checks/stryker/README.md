# @sentiness/check-stryker

Runs StrykerJS with JSON reporting and converts surviving or uncovered mutants into Sentiness
findings. The check also reports `stryker.mutationScore` as a higher-is-better metric for baseline
trend and ratcheting workflows.

## Stryker Report Path

Sentiness reads the mutation report from one of these sources, in order:

1. **`checkConfig.reportPath`** — explicit path configured in `sentiness.config.json`:

   ```json
   {
     "checks": {
       "stryker": {
         "enabled": true,
         "reportPath": "reports/mutation/mutation.json"
       }
     }
   }
   ```

2. **JSON config file** — if `stryker.conf.json` or `stryker.config.json` exists in the project
   root, Sentiness reads the `jsonReporter.fileName` property from it:

   ```json
   {
     "jsonReporter": {
       "fileName": "reports/mutation/mutation.json"
     }
   }
   ```

3. **Default path** — `reports/mutation/mutation.json` (StrykerJS default).

> **Note for `.js`/`.mjs`/`.cjs` configs:** Sentiness does not execute JavaScript config files
> (security boundary). If your project uses `stryker.conf.mjs` or `stryker.conf.cjs`, use option 1
> (`checkConfig.reportPath`) or create a companion `stryker.conf.json` alongside it.

## Init Wizard Integration

When running `sentiness init`, the wizard detects `stryker.conf.{js,mjs,cjs}` and, if no JSON
companion is found, prompts for the report path and writes it as `checks.stryker.reportPath` in
`sentiness.config.json`.

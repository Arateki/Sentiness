# @sentiness/check-semgrep

Runs `semgrep --config=p/javascript --json` by default and maps Semgrep matches to Sentiness
security findings. Override `checks.semgrep.config` for a different ruleset and `paths` for a
smaller scan scope.

Semgrep locations include `startLine`/`startColumn` and `endLine`/`endColumn` whenever the JSON
report provides them.

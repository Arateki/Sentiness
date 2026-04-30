# @sentiness/check-jscpd

Runs `jscpd` with the JSON reporter and normalizes duplicated code blocks as Sentiness duplication
findings. By default the report is read from `.sentiness/cache/jscpd/jscpd-report.json`; set
`checks.jscpd.reportPath` if your jscpd version writes JSON elsewhere.

Each finding points at the first duplicated block and includes line/column ranges from the report.

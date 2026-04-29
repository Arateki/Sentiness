# @sentiness/check-coverage

Reads an Istanbul `coverage/coverage-final.json` report and converts file coverage gaps plus global
line coverage metrics into Sentiness results. It supports global and diff coverage thresholds through
check config and reports `coverage.lineCoverage` as a higher-is-better baseline metric.

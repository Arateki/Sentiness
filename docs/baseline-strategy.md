# Baseline Strategy

The baseline lets an existing project adopt Sentiness without blocking every task on old findings.
It is not a general ignore file. It is a committed snapshot of known findings and metric thresholds,
and new work is expected to stay at least as clean as that snapshot.

## Files

Default paths:

- `.sentiness/baseline.json`: committed baseline snapshot.
- `.sentiness/pending-feedback.json`: local pending feedback queue, ignored by `init`.
- `.sentiness/jobs/`: local background job state, ignored by `init`.
- `.sentiness/cache/`: local check cache state, ignored by `init`.

`sentiness init` writes `.gitignore` entries for the local runtime files. It does not ignore
`.sentiness/baseline.json` because that file is part of the repository contract.

## Initial Adoption

Run the baseline only after `doctor` confirms the configured checks can execute:

```sh
sentiness doctor
sentiness baseline init
```

`baseline init` runs all tiers, captures current findings, records numeric metrics, and writes the
snapshot to the configured baseline path. Later `sentiness check` runs suppress matching findings.

## Daily Runs

Use fast checks during edits:

```sh
sentiness check --tier=fast --compact
```

Use diff mode when an agent or CI job only wants findings in changed files:

```sh
sentiness check --tier=fast --diff --base=main
```

Diff precision is hunk-level when possible: a finding with a precise line is considered introduced
only when that line falls inside a changed hunk (parsed from `git diff --unified=0`). Findings
without a line — dependency, package, and repository-level findings — fall back to file-level
matching. In both cases the finding must also not be suppressed by the baseline.

Two check categories are exempt from the diff-mode drop: `security` and `platform`. Their findings
are always reported (marked `introducedInDiff: false` when outside the diff), because new security
advisories appear without the code changing and platform results signal Sentiness's own failures.
To accept a known vulnerability, add it to the baseline — the diff filter will not hide it.

## Accepting A Finding

Use `baseline accept` for a current finding that the team deliberately accepts. The command requires
both the fingerprint and a reason:

```sh
sentiness baseline accept \
  --fingerprint=<sha256> \
  --reason="Accepted until the legacy module is replaced" \
  --tier=fast
```

`--tier` defaults to `fast` and searches only that tier. Use `--tier=standard` or `--tier=slow`
when accepting findings from slower checks so the command does not run unrelated expensive tiers.

This is intentionally explicit. Do not modify `sentiness.config.*` or `.sentiness/baseline.json` by
hand to make a check pass.

## Updating Metric Baselines

Metrics are ratcheted, not loosened:

```sh
sentiness baseline update
```

For each numeric metric, Sentiness updates the baseline when the current value improved according to
the metric direction. Use `--metric <check.metric>` to update one metric:

```sh
sentiness baseline update --metric coverage.lineCoverage
```

If a targeted metric regressed, Sentiness exits non-zero and leaves the baseline unchanged. Use
`--force` only for an intentional, reviewed reset; it logs a warning because the change can hide a
real regression from future runs.

Checks define metric direction through `metricSpecs`. If no direction is supplied, numeric metrics
default to `higher-is-better`.

## Pruning Fixed Findings

When old findings are fixed, prune obsolete baseline entries:

```sh
sentiness baseline prune
```

The command re-runs all tiers, compares current fingerprints to the snapshot, and removes suppressed
entries that no longer appear.

## Trend Mode

Trend mode focuses on metric regressions:

```sh
sentiness check --tier=slow --trend
```

In trend mode, findings are suppressed from the visible report and metric regressions remain visible.
Use this for scheduled or slower quality gates where the question is whether the codebase regressed
against established metrics.

## Fingerprint Discipline

Suppression only works when check packages produce stable fingerprints. Good fingerprints include:

- Check ID.
- Rule ID.
- Relative file path.
- Normalized line content.
- An extra discriminator when multiple findings can share the same line.

Do not include volatile data such as absolute paths, timestamps, raw column offsets that shift
frequently, or localized wording from external tools when a stable rule/message pair is available.

## Review Rules

- Commit baseline changes with the code or config change that justifies them.
- Treat new baseline entries as reviewable debt, not formatting noise.
- Prefer `baseline prune` after cleanup work so the snapshot does not preserve fixed issues.
- Treat exit code `3` as an invalid verification run; fix the platform/check error before updating
  the baseline.

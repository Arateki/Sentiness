# @sentiness/check-playwright

Runs the target project's Playwright E2E suite (`playwright test --reporter=json`, slow tier) and
maps `unexpected` tests to `error` findings and `flaky` tests to `warning` findings.

Each finding carries the project-relative paths of the screenshots and traces Playwright captured
in `references` (images first), so a multimodal agent can open the screenshots with its vision
capabilities and judge the rendered UI state instead of inferring it from error text. Screenshots
are never embedded in the report — only paths.

The check declares `configFiles` (`playwright.config.ts`/`.js`/`.mjs`/`.cjs`) with no default
template (a useful Playwright config is project-specific), skips gracefully when no config file
exists, and reports `testsExpected`/`testsUnexpected`/`testsFlaky`/`testsSkipped` plus a
`passRate` metric (`higher-is-better`) that participates in baseline metric ratcheting.

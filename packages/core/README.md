# @sentiness/core

Core runtime and CLI package for Sentiness. It loads `sentiness.config.*`, resolves check packages,
runs checks by tier or trigger, applies baselines, emits the normalized report schema, manages
background jobs and pending feedback, and exposes the `sentiness` CLI binary from
`dist/cli/index.js`.

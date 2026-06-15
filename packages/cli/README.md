# @sentiness/cli

The thin global launcher for Sentiness. It reads the project's engine pin and
`sentiness.lock`, fetches `@sentiness/core` at the pinned version into
`~/.sentiness/cache` (overridable with `SENTINESS_HOME`), and spawns it with
`--cache-root`, forwarding every argument and the engine's exit code. It has no
dependency on `@sentiness/core` — that is what it fetches. Install it once with
`npm i -g @sentiness/cli`. For local engine development, point
`SENTINESS_ENGINE_PATH` at a built `@sentiness/core` checkout to bypass the
fetch.

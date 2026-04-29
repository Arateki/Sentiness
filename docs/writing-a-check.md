# Writing A Check

A Sentiness check is a small package that adapts one external tool to the shared report contract.
The check owns tool execution, output parsing, normalization, and stable fingerprints. Core owns
config loading, tier selection, baseline application, and report generation.

## Package Contract

Check packages are discovered from config IDs. The ID `biome` maps to
`@sentiness/check-biome`, and the package must default-export a `Check`.

Recommended layout:

```text
packages/checks/example/
|-- package.json
|-- README.md
|-- tsconfig.json
`-- src/
    |-- index.ts
    |-- example.ts
    |-- example.test.ts
    `-- normalize.ts
```

`src/index.ts` should export the default check:

```ts
export { exampleCheck as default } from './example.js';
```

## Minimal Check

```ts
import {
  asCheckId,
  asRuleId,
  computeFingerprint,
  type Check,
  type Finding,
} from '@sentiness/check-sdk';

const checkId = asCheckId('example');

export const exampleCheck: Check = {
  id: checkId,
  category: 'lint',
  defaultTier: 'fast',
  async detect(ctx) {
    const result = await ctx.process.execFile('example-tool', ['--version'], {
      cwd: ctx.cwd,
      signal: ctx.signal,
    });

    return result.exitCode === 0
      ? { available: true, version: result.stdout.trim() }
      : { available: false, reason: result.stderr || 'example-tool not found' };
  },
  async run(ctx) {
    const result = await ctx.process.execFile('example-tool', ['--json'], {
      cwd: ctx.cwd,
      signal: ctx.signal,
    });

    if (result.exitCode >= 2) {
      return {
        status: 'error',
        findings: [],
        durationMs: 0,
        errorMessage: result.stderr || `example-tool exited with ${result.exitCode}`,
      };
    }

    const ruleId = asRuleId('example-rule');
    const finding: Finding = {
      id: 'example:example-rule',
      checkId,
      ruleId,
      severity: 'warning',
      message: 'Example finding',
      location: { file: 'src/index.ts' },
      fingerprint: computeFingerprint({
        checkId,
        ruleId,
        relativeFilePath: 'src/index.ts',
        lineContent: 'const value = 1;',
      }),
    };

    return {
      status: 'violations',
      findings: [finding],
      durationMs: 0,
    };
  },
};
```

## Responsibilities

- Use `ctx.process.execFile()` instead of `child_process` directly.
- Use `ctx.fs` instead of direct `fs` access when reading project files.
- Pass `ctx.signal` to long-running process calls.
- Return `status: 'error'` for tool execution or parse failures that make findings unreliable.
- Return `status: 'skipped'` with `skipReason` when required input is absent but the run is valid.
- Keep normalization code separate from process execution when the tool output is non-trivial.
- Compute fingerprints from stable inputs: check ID, rule ID, relative file path, normalized line
  content, and an optional discriminator such as the tool message.

Do not read config files directly. Check-specific config is already available as `ctx.checkConfig`.

## Finding Shape

Each finding should include:

- `id`: stable human-readable check/rule identifier, for example `biome:noUnusedVariables`.
- `checkId`: the branded check ID.
- `ruleId`: the branded rule ID.
- `severity`: `error`, `warning`, or `info`.
- `message`: actionable text from the tool or normalized by the check.
- `location`: at least a relative file path when applicable.
- `fingerprint`: a stable SHA-256 hash from `computeFingerprint()`.

Optional fields such as `snippet`, `suggestion`, and `references` should be used only when they are
accurate enough for an agent to act on.

## Metrics

Checks may return numeric, string, or boolean metrics:

```ts
return {
  status: 'ok',
  findings: [],
  metrics: { lineCoverage: 87.5 },
  durationMs: 0,
};
```

Numeric metrics can participate in baseline trend detection when the check exposes `metricSpecs`:

```ts
metricSpecs: {
  lineCoverage: {
    direction: 'higher-is-better',
    description: 'Total line coverage percentage',
  },
},
```

Use `lower-is-better` for metrics such as surviving mutants, duplicate blocks, or vulnerability
counts.

## Testing

Prefer deterministic unit tests around normalization and the check's `run()` behavior. Existing
packages use `FakeProcessRunner`, `InMemoryFileSystem`, `InMemoryGit`, and `SilentLogger` from
`@sentiness/_test-utils` to avoid mocking Node globals.

Minimum coverage for a new check:

- `detect()` returns available and unavailable results.
- `run()` maps a clean tool result to `status: 'ok'`.
- `run()` maps findings to Sentiness severities, locations, messages, and fingerprints.
- Tool execution failures or invalid JSON return `status: 'error'`.
- Diff mode respects `ctx.changedFiles` when the tool supports target narrowing.

Run the package gate before considering the check done:

```sh
pnpm --filter @sentiness/check-example typecheck
pnpm --filter @sentiness/check-example test
pnpm lint
```

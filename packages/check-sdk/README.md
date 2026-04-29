# @sentiness/check-sdk

Public contract for Sentiness check packages. A check detects whether its backing tool is available, runs it through the injected process runner, and returns normalized findings with stable fingerprints.

```ts
import { asCheckId, asRuleId, computeFingerprint, type Check } from '@sentiness/check-sdk';

const check: Check = {
  id: asCheckId('example'),
  category: 'lint',
  defaultTier: 'fast',
  async detect(ctx) {
    const result = await ctx.process.execFile('example', ['--version'], { cwd: ctx.cwd });
    return result.exitCode === 0 ? { available: true } : { available: false, reason: result.stderr };
  },
  async run(ctx) {
    const ruleId = asRuleId('example-rule');
    const fingerprint = computeFingerprint({
      checkId: asCheckId('example'),
      ruleId,
      relativeFilePath: 'src/index.ts',
      lineContent: 'const value = 1;',
    });

    return {
      status: 'violations',
      durationMs: 1,
      findings: [{
        id: 'example:example-rule',
        checkId: asCheckId('example'),
        ruleId,
        severity: 'warning',
        message: 'Example finding',
        location: { file: 'src/index.ts' },
        fingerprint,
      }],
    };
  },
};

export default check;
```

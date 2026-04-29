import { asCheckId, asRuleId, type CheckResult } from '@sentiness/check-sdk';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../config/config.js';
import type { RunOutcome } from '../runner/runner.js';
import { buildReport, exitCodeFor } from './reporter.js';

describe('reporter', () => {
  it('builds a valid blocking report', () => {
    const checkId = asCheckId('fake');
    const result: CheckResult = {
      status: 'violations',
      durationMs: 2,
      findings: [
        {
          id: 'fake:error',
          checkId,
          ruleId: asRuleId('error'),
          severity: 'error',
          message: 'Fix this',
          location: { file: 'src/index.ts', startLine: 1 },
          fingerprint: 'a'.repeat(64),
        },
      ],
    };
    const outcome: RunOutcome = {
      runId: 'run',
      results: new Map([[checkId, result]]),
      checkMetadata: new Map([[checkId, { category: 'lint' }]]),
      startedAt: '2024-01-01T00:00:00.000Z',
      completedAt: '2024-01-01T00:00:01.000Z',
      durationMs: 1000,
      context: {
        cwd: '/project',
        tier: 'fast',
        trigger: null,
        mode: 'full',
        baseRef: null,
        headRef: 'HEAD',
        changedFiles: [],
      },
    };

    const report = buildReport(
      {
        outcome,
        baselineApplied: false,
        baselinePath: null,
        suppressedCount: 0,
        metricRegressions: [],
      },
      DEFAULT_CONFIG,
      { compact: false, omitOk: false },
    );

    expect(report.summary.blocking).toBe(true);
    expect(exitCodeFor(report)).toBe(1);
  });
});

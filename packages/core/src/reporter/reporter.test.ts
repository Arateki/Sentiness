import { asCheckId, asRuleId, type CheckResult } from '@sentiness/check-sdk';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../config/config.js';
import type { RunOutcome } from '../runner/runner.js';
import { buildReport, exitCodeFor } from './reporter.js';

describe('reporter', () => {
  const checkId = asCheckId('fake');
  const baseOutcome: RunOutcome = {
    runId: 'run',
    results: new Map(),
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

  it('builds a valid blocking report for errors', () => {
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
          location: { file: 'src/index.ts', startLine: 1, packageName: 'new-dep' },
          fingerprint: 'a'.repeat(64),
          snippet: 'const x = 1;',
          suggestion: { kind: 'refactor', description: 'Change to 2', replacement: 'const x = 2;' },
          references: ['https://example.com'],
          introducedInDiff: true,
        },
      ],
      metrics: { score: 100 },
      skipReason: 'none',
      errorMessage: 'none',
    };
    const outcome = { ...baseOutcome, results: new Map([[checkId, result]]) };

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
    expect(report.checks[0]?.findings[0]?.snippet).toBe('const x = 1;');
  });

  it('handles warnings without warningsAreErrors', () => {
    const result: CheckResult = {
      status: 'violations',
      durationMs: 2,
      findings: [
        {
          id: 'fake:warn',
          checkId,
          ruleId: asRuleId('warn'),
          severity: 'warning',
          message: 'Warning',
          location: { file: 'src/index.ts' },
          fingerprint: 'b'.repeat(64),
        },
        {
          id: 'fake:info',
          checkId,
          ruleId: asRuleId('info'),
          severity: 'info',
          message: 'Info',
          location: { file: 'src/index.ts' },
          fingerprint: 'c'.repeat(64),
        },
      ],
    };
    const outcome = { ...baseOutcome, results: new Map([[checkId, result]]) };

    const report = buildReport(
      {
        outcome,
        baselineApplied: true,
        baselinePath: 'path',
        suppressedCount: 1,
        metricRegressions: [
          { metric: 'm', baselineValue: 1, currentValue: 0, direction: 'higher-is-better' },
        ],
      },
      DEFAULT_CONFIG,
      { compact: false, omitOk: false },
    );

    expect(report.summary.blocking).toBe(false);
    expect(exitCodeFor(report)).toBe(0);
    expect(report.agentInstructions.shouldFix.length).toBe(1);
    expect(report.agentInstructions.informational.length).toBe(1);
    expect(report.trend.available).toBe(true);
  });

  it('handles warnings with warningsAreErrors', () => {
    const result: CheckResult = {
      status: 'violations',
      durationMs: 2,
      findings: [
        {
          id: 'fake:warn',
          checkId,
          ruleId: asRuleId('warn'),
          severity: 'warning',
          message: 'Warning',
          location: { file: 'src/index.ts' },
          fingerprint: 'b'.repeat(64),
        },
      ],
    };
    const outcome = { ...baseOutcome, results: new Map([[checkId, result]]) };

    const report = buildReport(
      {
        outcome,
        baselineApplied: false,
        baselinePath: null,
        suppressedCount: 0,
        metricRegressions: [],
      },
      { ...DEFAULT_CONFIG, reporting: { ...DEFAULT_CONFIG.reporting, warningsAreErrors: true } },
      { compact: false, omitOk: false },
    );

    expect(report.summary.blocking).toBe(true);
    expect(exitCodeFor(report)).toBe(2); // Blocking but no "error" severity
  });

  it('truncates findings if they exceed maxFindingsPerCheck', () => {
    const findings = Array.from({ length: 60 }).map((_, i) => ({
      id: `fake:err${i}`,
      checkId,
      ruleId: asRuleId('error'),
      severity: 'error' as const,
      message: 'Fix this',
      location: { file: 'src/index.ts' },
      fingerprint: i.toString().padStart(64, '0'),
    }));

    const result: CheckResult = { status: 'violations', durationMs: 2, findings };
    const outcome = { ...baseOutcome, results: new Map([[checkId, result]]) };

    const report = buildReport(
      {
        outcome,
        baselineApplied: false,
        baselinePath: null,
        suppressedCount: 0,
        metricRegressions: [],
      },
      DEFAULT_CONFIG,
      { compact: false, omitOk: false, maxFindingsPerCheck: 50 },
    );

    expect(report.checks[0]?.findings.length).toBe(50);
    expect(report.checks[0]?.truncated).toEqual({ total: 60, shown: 50 });
  });

  it('omits OK checks in compact mode', () => {
    const result: CheckResult = { status: 'ok', durationMs: 2, findings: [] };
    const outcome = { ...baseOutcome, results: new Map([[checkId, result]]) };

    const report = buildReport(
      {
        outcome,
        baselineApplied: false,
        baselinePath: null,
        suppressedCount: 0,
        metricRegressions: [],
      },
      DEFAULT_CONFIG,
      { compact: true, omitOk: false },
    );

    expect(report.checks.length).toBe(0);
  });

  it('reports errored and skipped checks', () => {
    const checkId2 = asCheckId('error');
    const checkId3 = asCheckId('skipped');
    const outcome = {
      ...baseOutcome,
      results: new Map([
        [checkId2, { status: 'error' as const, durationMs: 2, findings: [] }],
        [checkId3, { status: 'skipped' as const, durationMs: 2, findings: [] }],
      ]),
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

    expect(report.summary.checksErrored).toBe(1);
    expect(report.summary.checksSkipped).toBe(1);
    expect(report.summary.status).toBe('error');
  });

  it('throws error if result is missing in outcome', () => {
    const outcome = {
      ...baseOutcome,
      results: new Map([
        [asCheckId('another'), { status: 'ok' as const, durationMs: 2, findings: [] }],
      ]),
    };
    // To trigger the error, we need a checkId in results map that gets removed before mapping, but map uses keys.
    // Wait, the map uses `[...input.outcome.results.keys()]`. So it's impossible to have a missing result for a key we just iterated!
    // But we can cover the branch by hacking the map or calling `checkEntry` directly if exported, but it's private.
    // Let's just mock the Map's `get` method to return undefined.
    const _originalGet = outcome.results.get.bind(outcome.results);
    outcome.results.get = () => undefined;

    expect(() =>
      buildReport(
        {
          outcome,
          baselineApplied: false,
          baselinePath: null,
          suppressedCount: 0,
          metricRegressions: [],
        },
        DEFAULT_CONFIG,
        { compact: false, omitOk: false },
      ),
    ).toThrow(/Missing result for/);
  });
});

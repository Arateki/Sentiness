import { z } from 'zod';

export const SCHEMA_VERSION = '1.0' as const;

const SeveritySchema = z.enum(['error', 'warning', 'info']);
const TierSchema = z.enum(['fast', 'standard', 'slow']);
const CategorySchema = z.enum([
  'lint',
  'architecture',
  'test-quality',
  'coverage',
  'security',
  'duplication',
  'complexity',
  'platform',
]);
const CheckStatusSchema = z.enum(['ok', 'violations', 'error', 'skipped']);

const CheckMetricsSchema = z.record(z.string(), z.union([z.number(), z.string(), z.boolean()]));

const LocationSchema = z.object({
  file: z.string(),
  startLine: z.number().int().positive().optional(),
  startColumn: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
  endColumn: z.number().int().positive().optional(),
  packageName: z.string().optional(),
  packageVersion: z.string().optional(),
});

const SuggestionSchema = z.object({
  kind: z.enum(['refactor', 'add-test', 'upgrade', 'remove', 'rename', 'other']),
  description: z.string(),
  command: z.string().optional(),
});

const FindingSchema = z.object({
  id: z.string(),
  checkId: z.string(),
  ruleId: z.string(),
  severity: SeveritySchema,
  message: z.string(),
  location: LocationSchema,
  snippet: z.string().optional(),
  suggestion: SuggestionSchema.optional(),
  references: z.array(z.string()).optional(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  introducedInDiff: z.boolean().optional(),
});

const MetricRegressionSchema = z.object({
  metric: z.string(),
  baselineValue: z.number(),
  currentValue: z.number(),
  direction: z.enum(['higher-is-better', 'lower-is-better']),
});

export const ReportSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  sentinessVersion: z.string(),
  runId: z.string(),
  startedAt: z.string(),
  completedAt: z.string(),
  durationMs: z.number().nonnegative(),
  context: z.object({
    cwd: z.string(),
    tier: TierSchema,
    trigger: z.string().nullable(),
    mode: z.enum(['diff', 'trend', 'full']),
    baseRef: z.string().nullable(),
    headRef: z.string().nullable(),
    changedFiles: z.array(z.string()),
    addedDependencies: z.array(z.string()),
    removedDependencies: z.array(z.string()),
  }),
  summary: z.object({
    status: z.enum(['ok', 'violations', 'error']),
    totals: z.object({ error: z.number(), warning: z.number(), info: z.number() }),
    newInDiff: z.object({ error: z.number(), warning: z.number(), info: z.number() }),
    blocking: z.boolean(),
    topIssues: z.array(z.string()),
    checksRun: z.number(),
    checksSkipped: z.number(),
    checksErrored: z.number(),
  }),
  checks: z.array(
    z.object({
      id: z.string(),
      category: CategorySchema,
      status: CheckStatusSchema,
      durationMs: z.number().nonnegative(),
      metrics: CheckMetricsSchema.optional(),
      findings: z.array(FindingSchema),
      skipReason: z.string().optional(),
      errorMessage: z.string().optional(),
      truncated: z.object({ total: z.number(), shown: z.number() }).optional(),
    }),
  ),
  trend: z.object({
    available: z.boolean(),
    regressions: z.array(MetricRegressionSchema).optional(),
    reason: z.string().optional(),
  }),
  baseline: z.object({
    applied: z.boolean(),
    path: z.string(),
    suppressedFindings: z.number(),
  }),
  agentInstructions: z.object({
    blocking: z.boolean(),
    mustFix: z.array(z.string()),
    shouldFix: z.array(z.string()),
    informational: z.array(z.string()),
  }),
});

export type Report = z.infer<typeof ReportSchema>;
export type ReportMetricRegression = z.infer<typeof MetricRegressionSchema>;

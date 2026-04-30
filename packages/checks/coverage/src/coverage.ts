import { isAbsolute, join, relative } from 'node:path';
import {
  asCheckId,
  asRuleId,
  type Check,
  computeFingerprint,
  type Finding,
} from '@sentiness/check-sdk';
import { z } from 'zod';

const checkId = asCheckId('coverage');

const IstanbulStatementSchema = z.object({
  start: z.object({ line: z.number() }),
  end: z.object({ line: z.number() }),
});

const IstanbulFileCoverageSchema = z.object({
  path: z.string(),
  statementMap: z.record(z.string(), IstanbulStatementSchema.nullable()),
  s: z.record(z.string(), z.number()),
});

const IstanbulReportSchema = z.record(z.string(), IstanbulFileCoverageSchema);

const ThresholdConfigSchema = z
  .object({
    lineCoverage: z.number().min(0).max(100).optional(),
    diffLineCoverage: z.number().min(0).max(100).optional(),
  })
  .catchall(z.unknown());

const CoverageConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    tier: z.enum(['fast', 'standard', 'slow']).optional(),
    thresholds: ThresholdConfigSchema.optional(),
  })
  .catchall(z.unknown());

type IstanbulFileCoverage = z.infer<typeof IstanbulFileCoverageSchema>;
type CoverageConfig = z.infer<typeof CoverageConfigSchema>;

type CoverageResult = {
  readonly file: string;
  readonly coveredLines: number;
  readonly totalLines: number;
  readonly percent: number;
};

function calculateFileCoverage(fileCov: IstanbulFileCoverage): CoverageResult {
  const lineExecutions = new Map<number, number>();

  for (const [stmtId, hits] of Object.entries(fileCov.s)) {
    const stmt = fileCov.statementMap[stmtId];
    if (!stmt) {
      continue;
    }

    // Istanbul maps statements to line ranges. A statement usually stays on one line or spans multiple.
    // For simplicity, we just count the start line of the statement.
    const line = stmt.start.line;
    const currentHits = lineExecutions.get(line) ?? 0;
    lineExecutions.set(line, currentHits + hits);
  }

  let coveredLines = 0;
  for (const hits of lineExecutions.values()) {
    if (hits > 0) {
      coveredLines++;
    }
  }

  const totalLines = lineExecutions.size;
  const percent = totalLines === 0 ? 100 : (coveredLines / totalLines) * 100;

  return {
    file: fileCov.path,
    coveredLines,
    totalLines,
    percent,
  };
}

function readThresholds(config: CoverageConfig): {
  readonly lineCoverage?: number;
  readonly diffLineCoverage?: number;
} {
  const parsed = ThresholdConfigSchema.safeParse(config.thresholds);
  if (!parsed.success) {
    return {};
  }
  return {
    ...(typeof parsed.data.lineCoverage === 'number'
      ? { lineCoverage: parsed.data.lineCoverage }
      : {}),
    ...(typeof parsed.data.diffLineCoverage === 'number'
      ? { diffLineCoverage: parsed.data.diffLineCoverage }
      : {}),
  };
}

export const coverageCheck: Check<CoverageConfig> = {
  id: checkId,
  category: 'coverage',
  defaultTier: 'slow',
  metricSpecs: {
    lineCoverage: {
      direction: 'higher-is-better',
      description: 'Global line coverage percentage',
    },
  },
  configSchema: CoverageConfigSchema,
  async detect(ctx) {
    const reportPath = join(ctx.cwd, 'coverage/coverage-final.json');
    if (!(await ctx.fs.exists(reportPath))) {
      return {
        available: false,
        reason: `no Istanbul coverage report at ${reportPath}; configure Vitest/Jest to emit one`,
      };
    }
    return { available: true };
  },
  async run(ctx) {
    const reportPath = join(ctx.cwd, 'coverage/coverage-final.json');
    if (!(await ctx.fs.exists(reportPath))) {
      return {
        status: 'skipped',
        findings: [],
        durationMs: 0,
        skipReason: `no coverage report found at ${reportPath}`,
      };
    }

    let parsed: z.infer<typeof IstanbulReportSchema>;
    try {
      const content = await ctx.fs.readFile(reportPath);
      parsed = IstanbulReportSchema.parse(JSON.parse(content));
    } catch (error) {
      return {
        status: 'error',
        findings: [],
        durationMs: 0,
        errorMessage: error instanceof Error ? error.message : 'failed to parse coverage report',
      };
    }

    // Default thresholds
    const thresholds = readThresholds(ctx.checkConfig);
    const globalThreshold =
      typeof thresholds?.lineCoverage === 'number' ? thresholds.lineCoverage : 80;
    const diffThreshold =
      typeof thresholds?.diffLineCoverage === 'number'
        ? thresholds.diffLineCoverage
        : globalThreshold;

    const findings: Finding[] = [];
    const changedSet = new Set(ctx.changedFiles.map((file) => join(ctx.cwd, file)));
    let globalCovered = 0;
    let globalTotal = 0;

    for (const [absPath, fileCov] of Object.entries(parsed)) {
      const cov = calculateFileCoverage(fileCov);
      globalCovered += cov.coveredLines;
      globalTotal += cov.totalLines;

      const isChanged = changedSet.has(absPath);

      // If diffOnly is enabled, we only care about changed files.
      if (ctx.diffOnly && !isChanged) {
        continue;
      }

      const threshold = isChanged ? diffThreshold : globalThreshold;

      if (cov.percent < threshold) {
        const relativePath = isAbsolute(absPath) ? relative(ctx.cwd, absPath) : absPath;
        findings.push({
          id: `coverage:${relativePath}`,
          checkId,
          ruleId: asRuleId('coverage-below-threshold'),
          severity: 'warning',
          message: `File coverage (${cov.percent.toFixed(2)}%) is below threshold of ${threshold}%`,
          location: { file: relativePath },
          fingerprint: computeFingerprint({
            checkId,
            ruleId: asRuleId('coverage-below-threshold'),
            relativeFilePath: relativePath,
            lineContent: '',
            extraDiscriminator: threshold.toString(),
          }),
        });
      }
    }

    const globalPercent = globalTotal === 0 ? 100 : (globalCovered / globalTotal) * 100;

    return {
      status: findings.length > 0 ? 'violations' : 'ok',
      findings,
      durationMs: 0,
      metrics: {
        lineCoverage: globalPercent,
      },
    };
  },
};

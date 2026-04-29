import { isAbsolute, join, relative } from 'node:path';
import {
  asCheckId,
  asRuleId,
  type Check,
  type CheckContext,
  computeFingerprint,
  type Finding,
} from '@sentiness/check-sdk';
import { z } from 'zod';

const checkId = asCheckId('stryker');

const StrykerMutantSchema = z.object({
  id: z.string(),
  mutatorName: z.string(),
  replacement: z.string(),
  location: z.object({
    start: z.object({ line: z.number(), column: z.number() }),
    end: z.object({ line: z.number(), column: z.number() }),
  }),
  status: z.string(),
  static: z.boolean().optional(),
});

const StrykerFileSchema = z.object({
  language: z.string(),
  mutants: z.array(StrykerMutantSchema),
  source: z.string().optional(),
});

const StrykerReportSchema = z.object({
  schemaVersion: z.string(),
  thresholds: z.object({ high: z.number(), low: z.number(), break: z.number() }).optional(),
  files: z.record(z.string(), StrykerFileSchema),
});

type StrykerReport = z.infer<typeof StrykerReportSchema>;

const StrykerJsonConfigSchema = z
  .object({
    jsonReporter: z
      .object({
        fileName: z.string().optional(),
      })
      .optional(),
  })
  .catchall(z.unknown());

function configuredReportPath(ctx: CheckContext): string | undefined {
  const reportPath = ctx.checkConfig.reportPath;
  return typeof reportPath === 'string' && reportPath.length > 0 ? reportPath : undefined;
}

async function reportPathFromJsonConfig(ctx: CheckContext): Promise<string | undefined> {
  for (const candidate of ['stryker.conf.json', 'stryker.config.json']) {
    const configPath = join(ctx.cwd, candidate);
    if (!(await ctx.fs.exists(configPath))) {
      continue;
    }
    try {
      const parsed = StrykerJsonConfigSchema.parse(JSON.parse(await ctx.fs.readFile(configPath)));
      const fileName = parsed.jsonReporter?.fileName;
      if (fileName) {
        return isAbsolute(fileName) ? fileName : join(ctx.cwd, fileName);
      }
    } catch (error) {
      ctx.logger.warn(`Failed to parse ${candidate}`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return undefined;
}

async function resolveReportPath(ctx: CheckContext): Promise<string> {
  const configured = configuredReportPath(ctx);
  if (configured) {
    return isAbsolute(configured) ? configured : join(ctx.cwd, configured);
  }
  return (await reportPathFromJsonConfig(ctx)) ?? join(ctx.cwd, 'reports/mutation/mutation.json');
}

async function getReport(ctx: CheckContext): Promise<StrykerReport | undefined> {
  const reportPath = await resolveReportPath(ctx);
  if (!(await ctx.fs.exists(reportPath))) {
    return undefined;
  }
  try {
    const content = await ctx.fs.readFile(reportPath);
    return StrykerReportSchema.parse(JSON.parse(content));
  } catch (error) {
    ctx.logger.error(`Failed to parse Stryker report at ${reportPath}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

export const strykerCheck: Check = {
  id: checkId,
  category: 'test-quality',
  defaultTier: 'slow',
  metricSpecs: {
    mutationScore: {
      direction: 'higher-is-better',
      description: 'Killed mutants as percentage of total mutants',
    },
  },
  async detect(ctx) {
    const result = await ctx.process.execFile('stryker', ['--version'], {
      cwd: ctx.cwd,
      signal: ctx.signal,
    });
    if (result.exitCode !== 0) {
      return { available: false, reason: 'stryker not found' };
    }
    return { available: true, version: result.stdout.trim() };
  },
  async run(ctx) {
    // Run stryker
    const runResult = await ctx.process.execFile(
      'stryker',
      ['run', '--reporters', 'json', '--incremental'],
      { cwd: ctx.cwd, signal: ctx.signal },
    );

    // Stryker might exit with non-zero if mutants survived, but we check if report exists
    const report = await getReport(ctx);
    if (!report) {
      return {
        status: 'error',
        findings: [],
        durationMs: 0,
        errorMessage: runResult.stderr || 'failed to generate or read stryker report',
      };
    }

    const findings: Finding[] = [];
    let totalMutants = 0;
    let killedMutants = 0;

    for (const [filePath, fileData] of Object.entries(report.files)) {
      const relPath = isAbsolute(filePath) ? relative(ctx.cwd, filePath) : filePath;

      for (const mutant of fileData.mutants) {
        totalMutants++;
        if (mutant.status === 'Killed' || mutant.status === 'Timeout') {
          killedMutants++;
          continue;
        }

        if (mutant.status === 'Survived' || mutant.status === 'NoCoverage') {
          findings.push({
            id: `stryker:${mutant.id}`,
            checkId,
            ruleId: asRuleId('stryker-survived'),
            severity: mutant.status === 'Survived' ? 'warning' : 'info',
            message: `Mutant survived: ${mutant.mutatorName} (replaced with "${mutant.replacement}")`,
            location: {
              file: relPath,
              startLine: mutant.location.start.line,
              startColumn: mutant.location.start.column + 1,
            },
            fingerprint: computeFingerprint({
              checkId,
              ruleId: asRuleId('stryker-survived'),
              relativeFilePath: relPath,
              lineContent: mutant.replacement,
              extraDiscriminator: mutant.mutatorName,
            }),
          });
        }
      }
    }

    const mutationScore = totalMutants === 0 ? 100 : (killedMutants / totalMutants) * 100;

    return {
      status: findings.length > 0 ? 'violations' : 'ok',
      findings,
      durationMs: 0,
      metrics: {
        mutationScore,
      },
    };
  },
};

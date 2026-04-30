import { isAbsolute, join } from 'node:path';
import {
  asCheckId,
  asRuleId,
  type Check,
  type CheckContext,
  computeFingerprint,
  type Finding,
} from '@sentiness/check-sdk';
import { z } from 'zod';
import { jscpdMetrics, type NormalizedJscpdDuplicate, normalizeJscpdOutput } from './normalize.js';

const checkId = asCheckId('jscpd');

const JscpdConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    tier: z.enum(['fast', 'standard', 'slow']).optional(),
    paths: z.array(z.string().min(1)).optional(),
    outputPath: z.string().min(1).optional(),
    reportPath: z.string().min(1).optional(),
    threshold: z.number().min(0).max(100).optional(),
    minLines: z.number().int().positive().optional(),
    extraArgs: z.array(z.string()).optional(),
  })
  .catchall(z.unknown());

type JscpdConfig = z.infer<typeof JscpdConfigSchema>;
type FileCache = Map<string, readonly string[]>;

function outputPath(ctx: CheckContext<JscpdConfig>): string {
  return ctx.checkConfig.outputPath ?? '.sentiness/cache/jscpd';
}

function reportPath(ctx: CheckContext<JscpdConfig>): string {
  return ctx.checkConfig.reportPath ?? join(outputPath(ctx), 'jscpd-report.json');
}

async function lineContent(
  ctx: CheckContext<JscpdConfig>,
  cache: FileCache,
  file: string,
  line: number | undefined,
): Promise<string> {
  if (!line) {
    return '';
  }
  const path = isAbsolute(file) ? file : join(ctx.cwd, file);
  if (!cache.has(path)) {
    try {
      const content = await ctx.fs.readFile(path);
      cache.set(path, content.split(/\r?\n/));
    } catch (error) {
      ctx.logger.debug(`Failed to read ${file} for jscpd fingerprint context`, {
        error: error instanceof Error ? error.message : String(error),
      });
      cache.set(path, []);
    }
  }
  const lines = cache.get(path) ?? [];
  return lines[line - 1] ?? '';
}

async function toFinding(
  ctx: CheckContext<JscpdConfig>,
  cache: FileCache,
  duplicate: NormalizedJscpdDuplicate,
): Promise<Finding> {
  const ruleId = asRuleId(duplicate.ruleId);
  const content = await lineContent(ctx, cache, duplicate.file, duplicate.startLine);
  return {
    id: `jscpd:${duplicate.file}:${duplicate.startLine ?? 0}:${duplicate.pairedFile ?? 'unknown'}`,
    checkId,
    ruleId,
    severity: duplicate.severity,
    message: duplicate.message,
    location: {
      file: duplicate.file,
      ...(duplicate.startLine ? { startLine: duplicate.startLine } : {}),
      ...(duplicate.startColumn ? { startColumn: duplicate.startColumn } : {}),
      ...(duplicate.endLine ? { endLine: duplicate.endLine } : {}),
      ...(duplicate.endColumn ? { endColumn: duplicate.endColumn } : {}),
    },
    ...(duplicate.snippet ? { snippet: duplicate.snippet } : {}),
    suggestion: {
      kind: 'refactor',
      description: duplicate.pairedFile
        ? `Extract or simplify duplicated code shared with ${duplicate.pairedFile}.`
        : 'Extract or simplify this duplicated code block.',
    },
    fingerprint: computeFingerprint({
      checkId,
      ruleId,
      relativeFilePath: duplicate.file,
      lineContent: content,
      extraDiscriminator: `${duplicate.pairedFile ?? ''}:${duplicate.lines ?? ''}:${duplicate.tokens ?? ''}`,
    }),
  };
}

function runArgs(ctx: CheckContext<JscpdConfig>): readonly string[] {
  const paths =
    ctx.checkConfig.paths && ctx.checkConfig.paths.length > 0 ? ctx.checkConfig.paths : ['.'];
  return [
    '--reporters',
    'json',
    '--output',
    outputPath(ctx),
    '--silent',
    ...(ctx.checkConfig.threshold !== undefined
      ? ['--threshold', ctx.checkConfig.threshold.toString()]
      : []),
    ...(ctx.checkConfig.minLines !== undefined
      ? ['--min-lines', ctx.checkConfig.minLines.toString()]
      : []),
    ...(ctx.checkConfig.extraArgs ?? []),
    ...paths,
  ];
}

export const jscpdCheck: Check<JscpdConfig> = {
  id: checkId,
  category: 'duplication',
  defaultTier: 'standard',
  configSchema: JscpdConfigSchema,
  async detect(ctx) {
    const result = await ctx.process.execFile('jscpd', ['--version'], {
      cwd: ctx.cwd,
      signal: ctx.signal,
    });
    if (result.exitCode !== 0) {
      return { available: false, reason: result.stderr || 'jscpd not found' };
    }
    return { available: true, version: result.stdout.trim() };
  },
  async run(ctx) {
    if (ctx.diffOnly && ctx.changedFiles.length === 0) {
      return { status: 'ok', findings: [], durationMs: 0 };
    }

    await ctx.fs.mkdir(join(ctx.cwd, outputPath(ctx)), { recursive: true });
    const result = await ctx.process.execFile('jscpd', runArgs(ctx), {
      cwd: ctx.cwd,
      signal: ctx.signal,
    });

    let parsed: unknown;
    try {
      const absoluteReportPath = join(ctx.cwd, reportPath(ctx));
      const reportContent = (await ctx.fs.exists(absoluteReportPath))
        ? await ctx.fs.readFile(absoluteReportPath)
        : result.stdout;
      parsed = reportContent.trim().length > 0 ? JSON.parse(reportContent) : { duplicates: [] };
    } catch (error) {
      if (result.exitCode !== 0) {
        return {
          status: 'error',
          findings: [],
          durationMs: 0,
          errorMessage: result.stderr || `jscpd exited with ${result.exitCode}`,
        };
      }
      return {
        status: 'error',
        findings: [],
        durationMs: 0,
        errorMessage:
          error instanceof Error
            ? `failed to parse jscpd JSON: ${error.message}`
            : 'failed to parse jscpd JSON',
      };
    }

    const cache: FileCache = new Map();
    let findings = await Promise.all(
      normalizeJscpdOutput(parsed).map((duplicate) => toFinding(ctx, cache, duplicate)),
    );

    if (ctx.diffOnly) {
      const changedSet = new Set(ctx.changedFiles);
      findings = findings.filter((finding) => changedSet.has(finding.location.file));
    }

    if (result.exitCode !== 0 && findings.length === 0) {
      return {
        status: 'error',
        findings: [],
        durationMs: 0,
        errorMessage: result.stderr || result.stdout || `jscpd exited with ${result.exitCode}`,
      };
    }

    return {
      status: findings.length > 0 ? 'violations' : 'ok',
      findings,
      durationMs: 0,
      metrics: jscpdMetrics(parsed),
    };
  },
};

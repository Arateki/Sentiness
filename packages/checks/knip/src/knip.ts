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
import { filterIgnoredDependencies } from './ignore.js';
import { type NormalizedKnipIssue, normalizeKnipOutput } from './normalize.js';

const checkId = asCheckId('knip');

const KnipConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    tier: z.enum(['fast', 'standard', 'slow']).optional(),
    /**
     * Extra dependency names/patterns to drop from knip's unused-dependency
     * findings, on top of the built-in Sentiness defaults. Matched as anchored
     * regular expressions against the dependency name.
     */
    ignoreDependencies: z.array(z.string()).optional(),
  })
  .catchall(z.unknown());

type KnipConfig = z.infer<typeof KnipConfigSchema>;

type FileCache = Map<string, readonly string[]>;

async function lineContent(
  ctx: CheckContext<KnipConfig>,
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
      ctx.logger.debug(`Failed to read ${file} for Knip fingerprint context`, {
        error: error instanceof Error ? error.message : String(error),
      });
      cache.set(path, []);
    }
  }
  const lines = cache.get(path) ?? [];
  return lines[line - 1] ?? '';
}

async function toFinding(
  ctx: CheckContext<KnipConfig>,
  cache: FileCache,
  issue: NormalizedKnipIssue,
): Promise<Finding> {
  const ruleId = asRuleId(issue.ruleId);
  const content = await lineContent(ctx, cache, issue.file, issue.line);

  return {
    id: `knip:${issue.ruleId}:${issue.file}:${issue.name ?? 'unknown'}`,
    checkId,
    ruleId,
    severity: issue.severity,
    message: issue.message,
    location: {
      file: issue.file,
      ...(issue.line ? { startLine: issue.line } : {}),
      ...(issue.column ? { startColumn: issue.column } : {}),
    },
    fingerprint: computeFingerprint({
      checkId,
      ruleId,
      relativeFilePath: issue.file,
      lineContent: content,
      extraDiscriminator: issue.name ?? '',
    }),
  };
}

export const knipCheck: Check<KnipConfig> = {
  id: checkId,
  category: 'architecture',
  defaultTier: 'standard',
  configSchema: KnipConfigSchema,
  async detect(ctx) {
    // Knip is typically installed locally. We check if `knip` is available via npx/pnpm exec
    const result = await ctx.process.execFile('knip', ['--version'], {
      cwd: ctx.cwd,
      signal: ctx.signal,
    });
    if (result.exitCode !== 0) {
      return { available: false, reason: result.stderr || 'knip not found' };
    }
    return { available: true, version: result.stdout.trim() };
  },
  async run(ctx) {
    if (ctx.diffOnly && ctx.changedFiles.length === 0) {
      return { status: 'ok', findings: [], durationMs: 0 };
    }

    // Knip doesn't easily support linting *only* specific files because it's a whole-project analysis tool.
    // We run it on the whole project and filter findings by changed files if diffOnly is true.
    const result = await ctx.process.execFile('knip', ['--reporter', 'json'], {
      cwd: ctx.cwd,
      signal: ctx.signal,
    });

    let parsed: unknown;
    try {
      parsed = result.stdout.trim().length > 0 ? JSON.parse(result.stdout) : {};
    } catch (error) {
      return {
        status: 'error',
        findings: [],
        durationMs: 0,
        errorMessage: error instanceof Error ? error.message : 'failed to parse knip JSON',
      };
    }

    // knip flags Sentiness's own check packages and the tool binaries they wrap
    // (run by dynamic dispatch / execFile, never `import`ed) as unused
    // dependencies. Drop those false-positives before they become blocking
    // findings, merging the built-in defaults with any user-supplied patterns.
    const issues = filterIgnoredDependencies(
      normalizeKnipOutput(parsed),
      ctx.checkConfig.ignoreDependencies ?? [],
    );

    const cache: FileCache = new Map();
    let findings = await Promise.all(issues.map((issue) => toFinding(ctx, cache, issue)));

    if (ctx.diffOnly) {
      const changedSet = new Set(ctx.changedFiles);
      findings = findings.filter(
        (f) => changedSet.has(f.location.file) || f.location.file === 'package.json',
      );
    }

    return {
      status: findings.length > 0 ? 'violations' : 'ok',
      findings,
      durationMs: 0,
    };
  },
};

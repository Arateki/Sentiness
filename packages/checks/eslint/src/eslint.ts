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
import { type NormalizedEslintDiagnostic, normalizeEslintOutput } from './normalize.js';

const checkId = asCheckId('eslint');

// Flat-config candidates only: this check targets ecosystems where the
// project's own ESLint setup (e.g. eslint-plugin-vue) must drive the rules.
const ESLINT_CONFIG_FILES = [
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
  'eslint.config.ts',
  'eslint.config.mts',
  'eslint.config.cts',
] as const;

const EslintConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    tier: z.enum(['fast', 'standard', 'slow']).optional(),
    targets: z.array(z.string()).optional(),
    extraArgs: z.array(z.string()).optional(),
  })
  .catchall(z.unknown());

type EslintConfig = z.infer<typeof EslintConfigSchema>;
type FileCache = Map<string, readonly string[]>;

async function findConfigFile(ctx: CheckContext<EslintConfig>): Promise<string | undefined> {
  for (const candidate of ESLINT_CONFIG_FILES) {
    if (await ctx.fs.exists(join(ctx.cwd, candidate))) {
      return candidate;
    }
  }
  return undefined;
}

async function lineContent(
  ctx: CheckContext<EslintConfig>,
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
      ctx.logger.debug(`Failed to read ${file} for ESLint fingerprint context`, {
        error: error instanceof Error ? error.message : String(error),
      });
      cache.set(path, []);
    }
  }
  const lines = cache.get(path) ?? [];
  return lines[line - 1] ?? '';
}

async function toFinding(
  ctx: CheckContext<EslintConfig>,
  cache: FileCache,
  diagnostic: NormalizedEslintDiagnostic,
): Promise<Finding> {
  const ruleId = asRuleId(diagnostic.ruleId);
  const content = await lineContent(ctx, cache, diagnostic.file, diagnostic.startLine);
  return {
    id: `eslint:${diagnostic.ruleId}`,
    checkId,
    ruleId,
    severity: diagnostic.severity,
    message: diagnostic.message,
    location: {
      file: diagnostic.file,
      ...(diagnostic.startLine !== undefined ? { startLine: diagnostic.startLine } : {}),
      ...(diagnostic.startColumn !== undefined ? { startColumn: diagnostic.startColumn } : {}),
      ...(diagnostic.endLine !== undefined ? { endLine: diagnostic.endLine } : {}),
      ...(diagnostic.endColumn !== undefined ? { endColumn: diagnostic.endColumn } : {}),
    },
    fingerprint: computeFingerprint({
      checkId,
      ruleId,
      relativeFilePath: diagnostic.file,
      lineContent: content,
      extraDiscriminator: diagnostic.message,
    }),
  };
}

export const eslintCheck: Check<EslintConfig> = {
  id: checkId,
  category: 'lint',
  defaultTier: 'standard',
  configSchema: EslintConfigSchema,
  configFiles: ESLINT_CONFIG_FILES,
  async detect(ctx) {
    const result = await ctx.process.execFile('eslint', ['--version'], {
      cwd: ctx.cwd,
      signal: ctx.signal,
    });
    if (result.exitCode !== 0) {
      return { available: false, reason: result.stderr || 'eslint not found' };
    }
    return { available: true, version: result.stdout.trim() };
  },
  async run(ctx) {
    const configFile = await findConfigFile(ctx);
    if (!configFile) {
      return {
        status: 'skipped',
        findings: [],
        durationMs: 0,
        skipReason: `no eslint.config.{js,mjs,cjs,ts,mts,cts} found in ${ctx.cwd}`,
      };
    }
    if (ctx.diffOnly && ctx.changedFiles.length === 0) {
      return { status: 'ok', findings: [], durationMs: 0 };
    }

    const targets = ctx.diffOnly ? ctx.changedFiles : (ctx.checkConfig.targets ?? ['.']);
    const result = await ctx.process.execFile(
      'eslint',
      ['--format', 'json', ...(ctx.checkConfig.extraArgs ?? []), ...targets],
      { cwd: ctx.cwd, signal: ctx.signal },
    );
    // ESLint exits 1 when lint problems were found and >= 2 on operational
    // failures (bad config, crash); only the latter is a check error.
    if (result.exitCode >= 2) {
      return {
        status: 'error',
        findings: [],
        durationMs: 0,
        errorMessage: result.stderr || result.stdout || `eslint exited with ${result.exitCode}`,
      };
    }

    let parsed: unknown;
    try {
      parsed = result.stdout.trim().length > 0 ? JSON.parse(result.stdout) : [];
    } catch (error) {
      return {
        status: 'error',
        findings: [],
        durationMs: 0,
        errorMessage: `failed to parse eslint JSON output: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }

    const normalized = normalizeEslintOutput(parsed, ctx.cwd);
    if (!normalized) {
      return {
        status: 'error',
        findings: [],
        durationMs: 0,
        errorMessage: 'unrecognized eslint JSON output shape (expected an array of results)',
      };
    }

    const cache: FileCache = new Map();
    const findings = await Promise.all(
      normalized.map((diagnostic) => toFinding(ctx, cache, diagnostic)),
    );

    return {
      status: findings.length > 0 ? 'violations' : 'ok',
      findings,
      durationMs: 0,
    };
  },
};

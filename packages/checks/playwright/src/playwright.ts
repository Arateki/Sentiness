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
import { type NormalizedPlaywrightTest, normalizePlaywrightOutput } from './normalize.js';

const checkId = asCheckId('playwright');

const PLAYWRIGHT_CONFIG_FILES = [
  'playwright.config.ts',
  'playwright.config.js',
  'playwright.config.mjs',
  'playwright.config.cjs',
] as const;

const PlaywrightConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    tier: z.enum(['fast', 'standard', 'slow']).optional(),
    extraArgs: z.array(z.string()).optional(),
  })
  .catchall(z.unknown());

type PlaywrightConfig = z.infer<typeof PlaywrightConfigSchema>;
type FileCache = Map<string, readonly string[]>;

async function findConfigFile(ctx: CheckContext<PlaywrightConfig>): Promise<string | undefined> {
  for (const candidate of PLAYWRIGHT_CONFIG_FILES) {
    if (await ctx.fs.exists(join(ctx.cwd, candidate))) {
      return candidate;
    }
  }
  return undefined;
}

async function lineContent(
  ctx: CheckContext<PlaywrightConfig>,
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
      ctx.logger.debug(`Failed to read ${file} for playwright fingerprint context`, {
        error: error instanceof Error ? error.message : String(error),
      });
      cache.set(path, []);
    }
  }
  const lines = cache.get(path) ?? [];
  return lines[line - 1] ?? '';
}

function relativeToProject(cwd: string, path: string): string {
  if (isAbsolute(path)) {
    const relativePath = relative(cwd, path);
    return relativePath.startsWith('..') ? path : relativePath;
  }
  return path;
}

async function toFinding(
  ctx: CheckContext<PlaywrightConfig>,
  cache: FileCache,
  test: NormalizedPlaywrightTest,
): Promise<Finding> {
  const ruleId = asRuleId(test.ruleId);
  const verb = test.ruleId === 'playwright-test-failed' ? 'failed' : 'was flaky';
  const project = test.projectName.length > 0 ? ` on ${test.projectName}` : '';
  const error = test.errorMessage.length > 0 ? `: ${test.errorMessage}` : '';
  const references = test.attachmentPaths.map((path) => relativeToProject(ctx.cwd, path));
  const content = await lineContent(ctx, cache, test.file, test.line);
  return {
    id: `playwright:${test.ruleId}:${test.titlePath}`,
    checkId,
    ruleId,
    severity: test.severity,
    message: `${test.titlePath} ${verb}${project}${error}`,
    location: {
      file: test.file,
      ...(test.line !== undefined ? { startLine: test.line } : {}),
      ...(test.column !== undefined ? { startColumn: test.column } : {}),
    },
    suggestion: {
      kind: 'other',
      description:
        'Open the referenced screenshot(s) to inspect the rendered UI state before changing the test or the code.',
    },
    ...(references.length > 0 ? { references } : {}),
    fingerprint: computeFingerprint({
      checkId,
      ruleId,
      relativeFilePath: test.file,
      lineContent: content,
      extraDiscriminator: `${test.projectName} ${test.titlePath}`,
    }),
  };
}

function passRate(expected: number, unexpected: number): number {
  const denominator = expected + unexpected;
  if (denominator === 0) {
    return 100;
  }
  return (expected / denominator) * 100;
}

export const playwrightCheck: Check<PlaywrightConfig> = {
  id: checkId,
  category: 'test-quality',
  defaultTier: 'slow',
  metricSpecs: {
    passRate: {
      direction: 'higher-is-better',
      description: 'Expected test outcomes as percentage of expected plus unexpected',
    },
  },
  configSchema: PlaywrightConfigSchema,
  configFiles: PLAYWRIGHT_CONFIG_FILES,
  async detect(ctx) {
    const result = await ctx.process.execFile('playwright', ['--version'], {
      cwd: ctx.cwd,
      signal: ctx.signal,
    });
    if (result.exitCode !== 0) {
      return { available: false, reason: result.stderr || 'playwright not found' };
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
        skipReason: `no playwright.config.{ts,js,mjs,cjs} found in ${ctx.cwd}`,
      };
    }

    const result = await ctx.process.execFile(
      'playwright',
      ['test', '--reporter=json', ...(ctx.checkConfig.extraArgs ?? [])],
      { cwd: ctx.cwd, signal: ctx.signal },
    );

    let parsed: unknown;
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      return {
        status: 'error',
        findings: [],
        durationMs: 0,
        errorMessage: `failed to parse playwright JSON output (exit ${result.exitCode}): ${
          result.stderr || result.stdout.slice(0, 200) || 'empty output'
        }`,
      };
    }

    const normalized = normalizePlaywrightOutput(parsed);
    if (!normalized || result.exitCode > 1) {
      return {
        status: 'error',
        findings: [],
        durationMs: 0,
        errorMessage: `playwright exited with ${result.exitCode}: ${
          result.stderr || 'unrecognized report shape'
        }`,
      };
    }

    const cache: FileCache = new Map();
    const findings = await Promise.all(normalized.tests.map((test) => toFinding(ctx, cache, test)));

    return {
      status: findings.length > 0 ? 'violations' : 'ok',
      findings,
      durationMs: 0,
      metrics: {
        testsExpected: normalized.stats.expected,
        testsUnexpected: normalized.stats.unexpected,
        testsFlaky: normalized.stats.flaky,
        testsSkipped: normalized.stats.skipped,
        passRate: passRate(normalized.stats.expected, normalized.stats.unexpected),
      },
    };
  },
};

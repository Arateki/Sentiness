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
import {
  type NormalizedDependencyCruiserViolation,
  normalizeDependencyCruiserOutput,
} from './normalize.js';

const checkId = asCheckId('dependency-cruiser');

const DependencyCruiserConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    tier: z.enum(['fast', 'standard', 'slow']).optional(),
    paths: z.array(z.string().min(1)).optional(),
    configPath: z.string().min(1).optional(),
    extraArgs: z.array(z.string()).optional(),
  })
  .catchall(z.unknown());

type DependencyCruiserConfig = z.infer<typeof DependencyCruiserConfigSchema>;
type FileCache = Map<string, readonly string[]>;

async function lineContent(
  ctx: CheckContext<DependencyCruiserConfig>,
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
      ctx.logger.debug(`Failed to read ${file} for dependency-cruiser fingerprint context`, {
        error: error instanceof Error ? error.message : String(error),
      });
      cache.set(path, []);
    }
  }
  const lines = cache.get(path) ?? [];
  return lines[line - 1] ?? '';
}

async function toFinding(
  ctx: CheckContext<DependencyCruiserConfig>,
  cache: FileCache,
  violation: NormalizedDependencyCruiserViolation,
): Promise<Finding> {
  const ruleId = asRuleId(violation.ruleId);
  const content = await lineContent(ctx, cache, violation.from, violation.startLine);
  return {
    id: `dependency-cruiser:${violation.ruleId}:${violation.from}:${violation.to ?? 'module'}`,
    checkId,
    ruleId,
    severity: violation.severity,
    message: violation.message,
    location: {
      file: violation.from,
      ...(violation.startLine ? { startLine: violation.startLine } : {}),
    },
    fingerprint: computeFingerprint({
      checkId,
      ruleId,
      relativeFilePath: violation.from,
      lineContent: content,
      extraDiscriminator: violation.to ?? violation.message,
    }),
  };
}

// Lookup order matches dependency-cruiser's own default config resolution.
const DEPENDENCY_CRUISER_CONFIG_FILES = [
  '.dependency-cruiser.cjs',
  '.dependency-cruiser.js',
  '.dependency-cruiser.mjs',
  '.dependency-cruiser.json',
] as const;

function defaultDependencyCruiserConfig(): { path: string; content: string } {
  return {
    path: '.dependency-cruiser.cjs',
    content: `/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular dependencies make modules harder to change safely.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      comment: 'Orphan modules are likely dead code; remove them or wire them in.',
      from: {
        orphan: true,
        pathNot: ['(^|/)[.][^/]+[.](?:js|cjs|mjs|ts|cts|mts|json)$', '[.]d[.]ts$'],
      },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
  },
};
`,
  };
}

function runArgs(config: DependencyCruiserConfig): readonly string[] {
  const paths = config.paths && config.paths.length > 0 ? config.paths : ['.'];
  return [
    '--output-type',
    'json',
    ...(config.configPath ? ['--config', config.configPath] : []),
    ...(config.extraArgs ?? []),
    ...paths,
  ];
}

export const dependencyCruiserCheck: Check<DependencyCruiserConfig> = {
  id: checkId,
  category: 'architecture',
  defaultTier: 'standard',
  configSchema: DependencyCruiserConfigSchema,
  configFiles: DEPENDENCY_CRUISER_CONFIG_FILES,
  defaultConfig: defaultDependencyCruiserConfig,
  async detect(ctx) {
    const result = await ctx.process.execFile('depcruise', ['--version'], {
      cwd: ctx.cwd,
      signal: ctx.signal,
    });
    if (result.exitCode !== 0) {
      return { available: false, reason: result.stderr || 'depcruise not found' };
    }
    return { available: true, version: result.stdout.trim() };
  },
  async run(ctx) {
    if (ctx.diffOnly && ctx.changedFiles.length === 0) {
      return { status: 'ok', findings: [], durationMs: 0 };
    }

    const result = await ctx.process.execFile('depcruise', runArgs(ctx.checkConfig), {
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
        errorMessage:
          error instanceof Error
            ? `failed to parse dependency-cruiser JSON: ${error.message}`
            : 'failed to parse dependency-cruiser JSON',
      };
    }

    const cache: FileCache = new Map();
    let findings = await Promise.all(
      normalizeDependencyCruiserOutput(parsed).map((violation) => toFinding(ctx, cache, violation)),
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
        errorMessage: result.stderr || result.stdout || `depcruise exited with ${result.exitCode}`,
      };
    }

    return {
      status: findings.length > 0 ? 'violations' : 'ok',
      findings,
      durationMs: 0,
    };
  },
};

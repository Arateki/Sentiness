import { join } from 'node:path';
import {
  asCheckId,
  asRuleId,
  type Check,
  type CheckContext,
  computeFingerprint,
  type Finding,
} from '@sentiness/check-sdk';
import { z } from 'zod';

const checkId = asCheckId('lockfile-lint');

const LockfileLintConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    tier: z.enum(['fast', 'standard', 'slow']).optional(),
    lockfiles: z.array(z.string().min(1)).optional(),
    allowedHosts: z.array(z.string().min(1)).optional(),
    validateHttps: z.boolean().optional(),
    validateIntegrity: z.boolean().optional(),
  })
  .catchall(z.unknown());

type LockfileLintConfig = z.infer<typeof LockfileLintConfigSchema>;
type SupportedLockfile = {
  readonly path: string;
  readonly type: 'npm' | 'yarn';
};

const defaultLockfiles: readonly SupportedLockfile[] = [
  { path: 'package-lock.json', type: 'npm' },
  { path: 'npm-shrinkwrap.json', type: 'npm' },
  { path: 'yarn.lock', type: 'yarn' },
];

async function findSupportedLockfiles(
  ctx: CheckContext<LockfileLintConfig>,
): Promise<readonly SupportedLockfile[]> {
  if (ctx.checkConfig.lockfiles && ctx.checkConfig.lockfiles.length > 0) {
    const configured: SupportedLockfile[] = [];
    for (const path of ctx.checkConfig.lockfiles) {
      if (path.endsWith('yarn.lock')) {
        configured.push({ path, type: 'yarn' });
      } else if (path.endsWith('package-lock.json') || path.endsWith('npm-shrinkwrap.json')) {
        configured.push({ path, type: 'npm' });
      }
    }
    return configured;
  }

  const found: SupportedLockfile[] = [];
  for (const candidate of defaultLockfiles) {
    if (await ctx.fs.exists(join(ctx.cwd, candidate.path))) {
      found.push(candidate);
    }
  }
  return found;
}

async function hasPnpmOnlyLockfile(ctx: CheckContext<LockfileLintConfig>): Promise<boolean> {
  return (
    (await ctx.fs.exists(join(ctx.cwd, 'pnpm-lock.yaml'))) &&
    (await findSupportedLockfiles(ctx)).length === 0
  );
}

function violationLines(output: string): readonly string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !/^success\b/i.test(line));
}

function ruleIdFor(line: string): string {
  const lower = line.toLowerCase();
  if (lower.includes('integrity')) {
    return 'invalid-integrity';
  }
  if (lower.includes('https') || lower.includes('scheme') || lower.includes('protocol')) {
    return 'invalid-protocol';
  }
  if (lower.includes('host')) {
    return 'disallowed-host';
  }
  if (lower.includes('package name')) {
    return 'package-name-mismatch';
  }
  return 'lockfile-policy';
}

function toFinding(lockfile: SupportedLockfile, line: string, index: number): Finding {
  const ruleId = asRuleId(ruleIdFor(line));
  return {
    id: `lockfile-lint:${lockfile.path}:${index}`,
    checkId,
    ruleId,
    severity: 'error',
    message: line,
    location: { file: lockfile.path },
    fingerprint: computeFingerprint({
      checkId,
      ruleId,
      relativeFilePath: lockfile.path,
      lineContent: line,
      extraDiscriminator: index.toString(),
    }),
  };
}

function lintArgs(config: LockfileLintConfig, lockfile: SupportedLockfile): readonly string[] {
  return [
    '--path',
    lockfile.path,
    '--type',
    lockfile.type,
    ...(config.validateHttps === false ? [] : ['--validate-https']),
    ...(config.validateIntegrity === false ? [] : ['--validate-integrity']),
    '--allowed-hosts',
    ...(config.allowedHosts && config.allowedHosts.length > 0
      ? config.allowedHosts
      : ['npm', 'yarn']),
  ];
}

export const lockfileLintCheck: Check<LockfileLintConfig> = {
  id: checkId,
  category: 'security',
  defaultTier: 'standard',
  configSchema: LockfileLintConfigSchema,
  async detect(ctx) {
    const lockfiles = await findSupportedLockfiles(ctx);
    if (lockfiles.length === 0) {
      const pnpmOnly = await hasPnpmOnlyLockfile(ctx);
      return {
        available: false,
        reason: pnpmOnly
          ? 'pnpm-lock.yaml is not supported by lockfile-lint'
          : 'no npm or Yarn lockfile found',
      };
    }

    const result = await ctx.process.execFile('lockfile-lint', ['--version'], {
      cwd: ctx.cwd,
      signal: ctx.signal,
    });
    if (result.exitCode !== 0) {
      return { available: false, reason: result.stderr || 'lockfile-lint not found' };
    }
    return { available: true, version: result.stdout.trim() };
  },
  async run(ctx) {
    const lockfiles = await findSupportedLockfiles(ctx);
    if (lockfiles.length === 0) {
      const pnpmOnly = await hasPnpmOnlyLockfile(ctx);
      return {
        status: 'skipped',
        findings: [],
        durationMs: 0,
        skipReason: pnpmOnly
          ? 'pnpm-lock.yaml is not supported by lockfile-lint'
          : 'no npm or Yarn lockfile found',
      };
    }

    const findings: Finding[] = [];
    for (const lockfile of lockfiles) {
      const result = await ctx.process.execFile(
        'lockfile-lint',
        lintArgs(ctx.checkConfig, lockfile),
        { cwd: ctx.cwd, signal: ctx.signal },
      );
      const lines = violationLines(`${result.stdout}\n${result.stderr}`);
      if (result.exitCode !== 0 && lines.length === 0) {
        return {
          status: 'error',
          findings: [],
          durationMs: 0,
          errorMessage: `lockfile-lint exited with ${result.exitCode}`,
        };
      }
      findings.push(...lines.map((line, index) => toFinding(lockfile, line, index)));
    }

    return {
      status: findings.length > 0 ? 'violations' : 'ok',
      findings,
      durationMs: 0,
    };
  },
};

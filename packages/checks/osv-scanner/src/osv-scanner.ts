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
import {
  type NormalizedOsvVulnerability,
  normalizeOsvOutput,
  type OsvLockfile,
} from './normalize.js';

const checkId = asCheckId('osv-scanner');

const OsvScannerConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    tier: z.enum(['fast', 'standard', 'slow']).optional(),
    lockfiles: z.array(z.string().min(1)).optional(),
    extraArgs: z.array(z.string()).optional(),
  })
  .catchall(z.unknown());

type OsvScannerConfig = z.infer<typeof OsvScannerConfigSchema>;

const defaultLockfiles: readonly OsvLockfile[] = [
  { path: 'package-lock.json', packageManager: 'npm' },
  { path: 'npm-shrinkwrap.json', packageManager: 'npm' },
  { path: 'pnpm-lock.yaml', packageManager: 'pnpm' },
  { path: 'yarn.lock', packageManager: 'yarn' },
];

function lockfileFromPath(path: string): OsvLockfile | undefined {
  if (path.endsWith('pnpm-lock.yaml')) {
    return { path, packageManager: 'pnpm' };
  }
  if (path.endsWith('yarn.lock')) {
    return { path, packageManager: 'yarn' };
  }
  if (path.endsWith('package-lock.json') || path.endsWith('npm-shrinkwrap.json')) {
    return { path, packageManager: 'npm' };
  }
  return undefined;
}

async function findLockfiles(ctx: CheckContext<OsvScannerConfig>): Promise<readonly OsvLockfile[]> {
  if (ctx.checkConfig.lockfiles && ctx.checkConfig.lockfiles.length > 0) {
    return ctx.checkConfig.lockfiles.flatMap((path) => {
      const lockfile = lockfileFromPath(path);
      return lockfile ? [lockfile] : [];
    });
  }

  const found: OsvLockfile[] = [];
  for (const candidate of defaultLockfiles) {
    if (await ctx.fs.exists(join(ctx.cwd, candidate.path))) {
      found.push(candidate);
    }
  }
  return found;
}

function upgradeCommand(
  lockfile: OsvLockfile,
  vulnerability: NormalizedOsvVulnerability,
): string | undefined {
  if (!vulnerability.fixedVersion) {
    return undefined;
  }
  const command =
    lockfile.packageManager === 'npm' ? 'npm install' : `${lockfile.packageManager} add`;
  return `${command} ${vulnerability.packageName}@${vulnerability.fixedVersion}`;
}

function toFinding(lockfile: OsvLockfile, vulnerability: NormalizedOsvVulnerability): Finding {
  const ruleId = asRuleId(vulnerability.id);
  const command = upgradeCommand(lockfile, vulnerability);
  return {
    id: `osv-scanner:${lockfile.path}:${vulnerability.packageName}:${vulnerability.id}`,
    checkId,
    ruleId,
    severity: vulnerability.severity,
    message: vulnerability.message,
    location: {
      file: lockfile.path,
      packageName: vulnerability.packageName,
      ...(vulnerability.packageVersion ? { packageVersion: vulnerability.packageVersion } : {}),
    },
    suggestion: {
      kind: 'upgrade',
      description: vulnerability.fixedVersion
        ? `Upgrade ${vulnerability.packageName} to ${vulnerability.fixedVersion} or later.`
        : `Review upgrade guidance for ${vulnerability.packageName}.`,
      ...(command ? { command } : {}),
    },
    references: vulnerability.references,
    fingerprint: computeFingerprint({
      checkId,
      ruleId,
      relativeFilePath: lockfile.path,
      lineContent: vulnerability.packageName,
      extraDiscriminator: vulnerability.packageVersion ?? '',
    }),
  };
}

export const osvScannerCheck: Check<OsvScannerConfig> = {
  id: checkId,
  category: 'security',
  defaultTier: 'slow',
  configSchema: OsvScannerConfigSchema,
  async detect(ctx) {
    const lockfiles = await findLockfiles(ctx);
    if (lockfiles.length === 0) {
      return { available: false, reason: 'no supported lockfile found' };
    }
    const result = await ctx.process.execFile('osv-scanner', ['--version'], {
      cwd: ctx.cwd,
      signal: ctx.signal,
    });
    if (result.exitCode !== 0) {
      return { available: false, reason: result.stderr || 'osv-scanner not found' };
    }
    return { available: true, version: result.stdout.trim() };
  },
  async run(ctx) {
    const lockfiles = await findLockfiles(ctx);
    if (lockfiles.length === 0) {
      return {
        status: 'skipped',
        findings: [],
        durationMs: 0,
        skipReason: 'no supported lockfile found',
      };
    }

    const findings: Finding[] = [];
    for (const lockfile of lockfiles) {
      const result = await ctx.process.execFile(
        'osv-scanner',
        ['scan', '--format', 'json', '-L', lockfile.path, ...(ctx.checkConfig.extraArgs ?? [])],
        { cwd: ctx.cwd, signal: ctx.signal },
      );
      if (![0, 1, 128].includes(result.exitCode)) {
        return {
          status: 'error',
          findings: [],
          durationMs: 0,
          errorMessage:
            result.stderr || result.stdout || `osv-scanner exited with ${result.exitCode}`,
        };
      }
      if (result.exitCode === 128 && result.stdout.trim().length === 0) {
        continue;
      }
      let parsed: unknown;
      try {
        parsed = result.stdout.trim().length > 0 ? JSON.parse(result.stdout) : { results: [] };
      } catch (error) {
        return {
          status: 'error',
          findings: [],
          durationMs: 0,
          errorMessage:
            error instanceof Error
              ? `failed to parse osv-scanner JSON: ${error.message}`
              : 'failed to parse osv-scanner JSON',
        };
      }
      findings.push(
        ...normalizeOsvOutput(parsed).map((vulnerability) => toFinding(lockfile, vulnerability)),
      );
    }

    return {
      status: findings.length > 0 ? 'violations' : 'ok',
      findings,
      durationMs: 0,
    };
  },
};

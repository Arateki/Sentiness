import { isAbsolute, join } from 'node:path';
import {
  asCheckId,
  asRuleId,
  type Check,
  type CheckContext,
  computeFingerprint,
  type Finding,
} from '@sentiness/check-sdk';
import { type NormalizedBiomeDiagnostic, normalizeBiomeOutput } from './normalize.js';

const checkId = asCheckId('biome');

type FileCache = Map<string, readonly string[]>;

async function lineContent(
  ctx: CheckContext,
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
      ctx.logger.debug(`Failed to read ${file} for Biome fingerprint context`, {
        error: error instanceof Error ? error.message : String(error),
      });
      cache.set(path, []);
    }
  }
  const lines = cache.get(path) ?? [];
  return lines[line - 1] ?? '';
}

async function toFinding(
  ctx: CheckContext,
  cache: FileCache,
  diagnostic: NormalizedBiomeDiagnostic,
): Promise<Finding> {
  const ruleId = asRuleId(diagnostic.ruleId);
  const content = await lineContent(ctx, cache, diagnostic.file, diagnostic.startLine);
  return {
    id: `biome:${diagnostic.ruleId}`,
    checkId,
    ruleId,
    severity: diagnostic.severity,
    message: diagnostic.message,
    location: {
      file: diagnostic.file,
      ...(diagnostic.startLine ? { startLine: diagnostic.startLine } : {}),
      ...(diagnostic.startColumn ? { startColumn: diagnostic.startColumn } : {}),
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

function isSentinessRuntimeFile(file: string): boolean {
  return file === '.sentiness' || file.startsWith('.sentiness/') || file.startsWith('.sentiness\\');
}

export const biomeCheck: Check = {
  id: checkId,
  category: 'lint',
  defaultTier: 'fast',
  async detect(ctx) {
    const result = await ctx.process.execFile('biome', ['--version'], {
      cwd: ctx.cwd,
      signal: ctx.signal,
    });
    if (result.exitCode !== 0) {
      return { available: false, reason: result.stderr || 'biome not found' };
    }
    return { available: true, version: result.stdout.trim() };
  },
  async run(ctx) {
    if (ctx.diffOnly && ctx.changedFiles.length === 0) {
      return { status: 'ok', findings: [], durationMs: 0 };
    }
    const targets = ctx.diffOnly ? ctx.changedFiles : ['.'];
    const result = await ctx.process.execFile(
      'biome',
      ['check', '--reporter=json', '--colors=off', '--max-diagnostics=none', ...targets],
      { cwd: ctx.cwd, signal: ctx.signal },
    );
    if (result.exitCode >= 2) {
      return {
        status: 'error',
        findings: [],
        durationMs: 0,
        errorMessage: result.stderr || result.stdout || `biome exited with ${result.exitCode}`,
      };
    }
    let parsed: unknown;
    try {
      parsed = result.stdout.trim().length > 0 ? JSON.parse(result.stdout) : { diagnostics: [] };
    } catch (error) {
      return {
        status: 'error',
        findings: [],
        durationMs: 0,
        errorMessage: error instanceof Error ? error.message : 'failed to parse biome JSON',
      };
    }
    const cache: FileCache = new Map();
    const findings = await Promise.all(
      normalizeBiomeOutput(parsed)
        .filter((diagnostic) => !isSentinessRuntimeFile(diagnostic.file))
        .map((diagnostic) => toFinding(ctx, cache, diagnostic)),
    );
    return {
      status: findings.length > 0 ? 'violations' : 'ok',
      findings,
      durationMs: 0,
    };
  },
};

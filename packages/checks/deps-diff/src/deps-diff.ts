import { join } from 'node:path';
import {
  asCheckId,
  asRuleId,
  type Check,
  computeFingerprint,
  type Finding,
} from '@sentiness/check-sdk';
import { z } from 'zod';

const checkId = asCheckId('deps-diff');

const dependencySectionNames = ['dependencies', 'devDependencies', 'optionalDependencies'] as const;

const DependencySectionSchema = z.record(z.string(), z.string()).optional();
const PackageJsonSchema = z
  .object({
    dependencies: DependencySectionSchema,
    devDependencies: DependencySectionSchema,
    optionalDependencies: DependencySectionSchema,
  })
  .catchall(z.unknown());

const DepsDiffConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    tier: z.enum(['fast', 'standard', 'slow']).optional(),
    baseRef: z.string().min(1).optional(),
    sections: z.array(z.enum(dependencySectionNames)).optional(),
  })
  .catchall(z.unknown());

type DependencySectionName = (typeof dependencySectionNames)[number];
type PackageJson = z.infer<typeof PackageJsonSchema>;
type DepsDiffConfig = z.infer<typeof DepsDiffConfigSchema>;

type DependencyChange = {
  readonly ruleId: 'new-dependency' | 'removed-dependency' | 'major-version-bump';
  readonly severity: 'warning' | 'info';
  readonly section: DependencySectionName;
  readonly name: string;
  readonly before?: string;
  readonly after?: string;
};

function parsePackageJson(content: string): PackageJson {
  return PackageJsonSchema.parse(JSON.parse(content));
}

function dependencySections(config: DepsDiffConfig): readonly DependencySectionName[] {
  return config.sections && config.sections.length > 0 ? config.sections : dependencySectionNames;
}

function normalizeVersion(version: string): string {
  return (
    version
      .trim()
      .replace(/^[\^~<>=\s]+/, '')
      .split(/\s+/)[0] ?? version.trim()
  );
}

function majorVersion(version: string): number | undefined {
  const normalized = normalizeVersion(version);
  const match = /^v?(\d+)(?:\.|$)/.exec(normalized);
  if (!match) {
    return undefined;
  }
  return Number.parseInt(match[1] ?? '', 10);
}

function findPackageLine(content: string, dependencyName: string): number | undefined {
  const lines = content.split(/\r?\n/);
  const quotedName = JSON.stringify(dependencyName);
  const index = lines.findIndex((line) => line.includes(quotedName));
  return index >= 0 ? index + 1 : undefined;
}

function lineAt(content: string, line: number | undefined): string {
  if (!line) {
    return '';
  }
  return content.split(/\r?\n/)[line - 1] ?? '';
}

function diffSection(
  section: DependencySectionName,
  before: Readonly<Record<string, string>>,
  after: Readonly<Record<string, string>>,
): readonly DependencyChange[] {
  const changes: DependencyChange[] = [];
  for (const [name, afterVersion] of Object.entries(after)) {
    const beforeVersion = before[name];
    if (beforeVersion === undefined) {
      changes.push({
        ruleId: 'new-dependency',
        severity: 'info',
        section,
        name,
        after: afterVersion,
      });
      continue;
    }
    const beforeMajor = majorVersion(beforeVersion);
    const afterMajor = majorVersion(afterVersion);
    if (beforeMajor !== undefined && afterMajor !== undefined && beforeMajor !== afterMajor) {
      changes.push({
        ruleId: 'major-version-bump',
        severity: 'warning',
        section,
        name,
        before: beforeVersion,
        after: afterVersion,
      });
    }
  }

  for (const [name, beforeVersion] of Object.entries(before)) {
    if (after[name] === undefined) {
      changes.push({
        ruleId: 'removed-dependency',
        severity: 'info',
        section,
        name,
        before: beforeVersion,
      });
    }
  }

  return changes;
}

function messageFor(change: DependencyChange): string {
  if (change.ruleId === 'new-dependency') {
    return `New ${change.section} dependency: ${change.name}@${change.after ?? 'unknown'}`;
  }
  if (change.ruleId === 'removed-dependency') {
    return `Removed ${change.section} dependency: ${change.name}@${change.before ?? 'unknown'}`;
  }
  return `Major version bump in ${change.section}: ${change.name} ${change.before ?? '?'} -> ${change.after ?? '?'}`;
}

function suggestionFor(change: DependencyChange): Finding['suggestion'] | undefined {
  if (change.ruleId === 'removed-dependency') {
    return {
      kind: 'remove',
      description: `Confirm ${change.name} is no longer required before merging.`,
    };
  }
  if (change.ruleId === 'new-dependency') {
    return {
      kind: 'other',
      description: `Review the need, license, and maintenance posture for ${change.name}.`,
    };
  }
  return {
    kind: 'upgrade',
    description: `Review migration notes for ${change.name} before accepting the major version change.`,
  };
}

function toFinding(change: DependencyChange, currentContent: string, baseContent: string): Finding {
  const ruleId = asRuleId(change.ruleId);
  const line =
    change.ruleId === 'removed-dependency'
      ? findPackageLine(baseContent, change.name)
      : findPackageLine(currentContent, change.name);
  const lineContent =
    change.ruleId === 'removed-dependency'
      ? lineAt(baseContent, line)
      : lineAt(currentContent, line);
  const version = change.after ?? change.before;
  const suggestion = suggestionFor(change);
  return {
    id: `deps-diff:${change.ruleId}:${change.name}`,
    checkId,
    ruleId,
    severity: change.severity,
    message: messageFor(change),
    location: {
      file: 'package.json',
      ...(line ? { startLine: line } : {}),
      packageName: change.name,
      ...(version ? { packageVersion: version } : {}),
    },
    ...(suggestion ? { suggestion } : {}),
    fingerprint: computeFingerprint({
      checkId,
      ruleId,
      relativeFilePath: 'package.json',
      lineContent,
      extraDiscriminator: `${change.section}:${change.name}:${change.before ?? ''}:${change.after ?? ''}`,
    }),
  };
}

export const depsDiffCheck: Check<DepsDiffConfig> = {
  id: checkId,
  category: 'architecture',
  defaultTier: 'fast',
  configSchema: DepsDiffConfigSchema,
  async detect(ctx) {
    const packageJsonPath = join(ctx.cwd, 'package.json');
    if (!(await ctx.fs.exists(packageJsonPath))) {
      return { available: false, reason: 'package.json not found' };
    }
    return { available: true };
  },
  async run(ctx) {
    if (!ctx.git) {
      return {
        status: 'error',
        findings: [],
        durationMs: 0,
        errorMessage: 'deps-diff requires a Git provider',
      };
    }

    const packageJsonPath = join(ctx.cwd, 'package.json');
    if (!(await ctx.fs.exists(packageJsonPath))) {
      return {
        status: 'skipped',
        findings: [],
        durationMs: 0,
        skipReason: 'package.json not found',
      };
    }

    const baseRef = ctx.checkConfig.baseRef ?? ctx.baseRef ?? 'HEAD';
    const baseContent = await ctx.git.fileContentAtRef(ctx.cwd, baseRef, 'package.json');
    if (baseContent === null) {
      return {
        status: 'skipped',
        findings: [],
        durationMs: 0,
        skipReason: `package.json not found at ${baseRef}`,
      };
    }

    let currentPackage: PackageJson;
    let basePackage: PackageJson;
    let currentContent: string;
    try {
      currentContent = await ctx.fs.readFile(packageJsonPath);
      currentPackage = parsePackageJson(currentContent);
      basePackage = parsePackageJson(baseContent);
    } catch (error) {
      return {
        status: 'error',
        findings: [],
        durationMs: 0,
        errorMessage: error instanceof Error ? error.message : 'failed to parse package.json',
      };
    }

    const changes = dependencySections(ctx.checkConfig).flatMap((section) =>
      diffSection(section, basePackage[section] ?? {}, currentPackage[section] ?? {}),
    );
    const findings = changes.map((change) => toFinding(change, currentContent, baseContent));

    return {
      status: findings.length > 0 ? 'violations' : 'ok',
      findings,
      durationMs: 0,
      metrics: {
        transitiveDiffAvailable: false,
      },
    };
  },
};

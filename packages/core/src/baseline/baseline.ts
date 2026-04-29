import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import type { CheckMetrics, FileSystem, Finding, GitProvider } from '@sentiness/check-sdk';
import { z } from 'zod';
import type { RunOutcome } from '../runner/runner.js';
import { BaselineSnapshotSchema } from './schema.js';

export type BaselineEntry = {
  readonly checkId: string;
  readonly ruleId: string;
  readonly fingerprint: string;
  readonly location: { readonly file: string; readonly startLine?: number };
  readonly addedAt: string;
  readonly reason: string;
};

export type MetricBaseline = {
  readonly value: number;
  readonly direction: 'higher-is-better' | 'lower-is-better';
};

export type BaselineSnapshot = {
  readonly schemaVersion: '1.0';
  readonly createdAt: string;
  readonly createdAtCommit: string;
  readonly suppressed: readonly BaselineEntry[];
  readonly metrics: Readonly<Record<string, MetricBaseline>>;
};

export class BaselineAcceptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BaselineAcceptError';
  }
}

export class BaselineParseError extends Error {
  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options);
    this.name = 'BaselineParseError';
  }
}

function zodErrorMessage(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
    .join('; ');
}

function normalizeSnapshot(snapshot: z.infer<typeof BaselineSnapshotSchema>): BaselineSnapshot {
  return {
    schemaVersion: snapshot.schemaVersion,
    createdAt: snapshot.createdAt,
    createdAtCommit: snapshot.createdAtCommit,
    suppressed: snapshot.suppressed.map((entry) => ({
      checkId: entry.checkId,
      ruleId: entry.ruleId,
      fingerprint: entry.fingerprint,
      location: {
        file: entry.location.file,
        ...(entry.location.startLine !== undefined ? { startLine: entry.location.startLine } : {}),
      },
      addedAt: entry.addedAt,
      reason: entry.reason,
    })),
    metrics: snapshot.metrics,
  };
}

function allFindings(outcome: RunOutcome): readonly Finding[] {
  return [...outcome.results.values()].flatMap((result) => result.findings);
}

function collectMetrics(outcome: RunOutcome): Readonly<Record<string, MetricBaseline>> {
  const metrics: Record<string, MetricBaseline> = {};
  for (const [checkId, result] of outcome.results) {
    for (const [name, value] of Object.entries(result.metrics ?? ({} satisfies CheckMetrics))) {
      if (typeof value === 'number') {
        metrics[`${checkId}.${name}`] = { value, direction: 'higher-is-better' };
      }
    }
  }
  return metrics;
}

function toEntry(finding: Finding, addedAt: string, reason: string): BaselineEntry {
  return {
    checkId: finding.checkId,
    ruleId: finding.ruleId,
    fingerprint: finding.fingerprint,
    location: {
      file: finding.location.file,
      ...(finding.location.startLine ? { startLine: finding.location.startLine } : {}),
    },
    addedAt,
    reason,
  };
}

function sortSnapshot(snapshot: BaselineSnapshot): BaselineSnapshot {
  return {
    ...snapshot,
    suppressed: [...snapshot.suppressed].sort((left, right) =>
      left.fingerprint.localeCompare(right.fingerprint),
    ),
  };
}

// biome-ignore lint/complexity/noStaticOnlyClass: The public spec exposes BaselineManager as a static facade.
export class BaselineManager {
  static async load(path: string, fs: FileSystem): Promise<BaselineSnapshot | undefined> {
    if (!(await fs.exists(path))) {
      return undefined;
    }
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(path));
      return normalizeSnapshot(BaselineSnapshotSchema.parse(parsed));
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new BaselineParseError(`Invalid baseline file: ${path}: ${zodErrorMessage(error)}`, {
          cause: error,
        });
      }
      throw new BaselineParseError(`Failed to parse baseline file: ${path}`, { cause: error });
    }
  }

  static async save(path: string, snapshot: BaselineSnapshot, fs: FileSystem): Promise<void> {
    await fs.mkdir(dirname(path), { recursive: true });
    const tempPath = `${path}.tmp.${randomUUID()}`;
    await fs.writeFile(tempPath, `${JSON.stringify(sortSnapshot(snapshot), null, 2)}\n`);
    await fs.rename(tempPath, path);
  }

  static async createFromOutcome(
    outcome: RunOutcome,
    git: GitProvider,
    cwd: string,
  ): Promise<BaselineSnapshot> {
    const commit = await git.showCommit(cwd, 'HEAD');
    return sortSnapshot({
      schemaVersion: '1.0',
      createdAt: outcome.completedAt,
      createdAtCommit: commit.sha,
      suppressed: allFindings(outcome).map((finding) =>
        toEntry(finding, outcome.completedAt, 'initial baseline'),
      ),
      metrics: collectMetrics(outcome),
    });
  }

  static prune(
    snapshot: BaselineSnapshot,
    currentFingerprints: ReadonlySet<string>,
  ): BaselineSnapshot {
    return sortSnapshot({
      ...snapshot,
      suppressed: snapshot.suppressed.filter((entry) => currentFingerprints.has(entry.fingerprint)),
    });
  }

  static accept(snapshot: BaselineSnapshot, finding: Finding, reason: string): BaselineSnapshot {
    if (reason.trim().length === 0) {
      throw new BaselineAcceptError('Baseline accept reason is required');
    }
    return sortSnapshot({
      ...snapshot,
      suppressed: [...snapshot.suppressed, toEntry(finding, new Date().toISOString(), reason)],
    });
  }
}

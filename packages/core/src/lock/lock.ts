import type { FileSystem } from '@sentiness/check-sdk';
import type { ResolvedConfig } from '../config/config.js';
import { LockSchema, type SentinessLock } from './schema.js';

export class LockParseError extends Error {
  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options);
    this.name = 'LockParseError';
  }
}

export interface SatisfiesResult {
  readonly ok: boolean;
  readonly reasons: readonly string[];
}

// Minimal range check WITHOUT a semver dependency. Supports exact ('1.2.3'),
// caret ('^1.2.3' => same major, >= base) and tilde ('~1.2.3' => same major.minor,
// >= base). Anything else (e.g. '*', '>=', ranges) is treated as "any non-empty
// version satisfies", which is safe here because `install` always writes a concrete
// version into the lock and re-validates against the registry.
function parseVersion(v: string): [number, number, number] | undefined {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined;
}

export function rangeSatisfied(range: string, version: string): boolean {
  if (version.length === 0) {
    return false;
  }
  if (range === version) {
    return true;
  }
  const op = range.startsWith('^') ? '^' : range.startsWith('~') ? '~' : '';
  if (op === '') {
    return /^[*x]$/.test(range) || range.startsWith('>=') || range === version;
  }
  const base = parseVersion(range.slice(1));
  const got = parseVersion(version);
  if (!base || !got) {
    return false;
  }
  if (op === '^') {
    return got[0] === base[0] && (got[1] > base[1] || (got[1] === base[1] && got[2] >= base[2]));
  }
  return got[0] === base[0] && got[1] === base[1] && got[2] >= base[2];
}

async function loadLock(path: string, fs: FileSystem): Promise<SentinessLock | undefined> {
  if (!(await fs.exists(path))) {
    return undefined;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(await fs.readFile(path));
  } catch (error) {
    throw new LockParseError(`Invalid JSON in ${path}`, { cause: error });
  }
  const parsed = LockSchema.safeParse(raw);
  if (!parsed.success) {
    throw new LockParseError(`Invalid lock file ${path}: ${parsed.error.message}`, {
      cause: parsed.error,
    });
  }
  return parsed.data;
}

async function saveLock(path: string, lock: SentinessLock, fs: FileSystem): Promise<void> {
  const sortedChecks = Object.fromEntries(
    Object.entries(lock.checks).sort(([a], [b]) => a.localeCompare(b)),
  );
  const ordered: SentinessLock = { ...lock, checks: sortedChecks };
  const tmp = `${path}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(ordered, null, 2)}\n`);
  await fs.rename(tmp, path);
}

function lockSatisfies(lock: SentinessLock, config: ResolvedConfig): SatisfiesResult {
  const reasons: string[] = [];
  if (!rangeSatisfied(config.engine, lock.engine.version)) {
    reasons.push(`engine: locked ${lock.engine.version} does not satisfy ${config.engine}`);
  }
  for (const [id, entry] of Object.entries(config.checks)) {
    const locked = lock.checks[id];
    if (!locked) {
      reasons.push(`check "${id}" is missing from the lock`);
      continue;
    }
    if (entry.path !== undefined) {
      if (locked.path !== entry.path) {
        reasons.push(
          `check "${id}" is path-linked to ${entry.path} but the lock has ${locked.path ?? locked.version}`,
        );
      }
      continue;
    }
    if (entry.version !== undefined && !rangeSatisfied(entry.version, locked.version ?? '')) {
      reasons.push(
        `check "${id}": locked ${locked.version ?? '(none)'} does not satisfy ${entry.version}`,
      );
    }
  }
  return { ok: reasons.length === 0, reasons };
}

export const LockManager = {
  load: loadLock,
  save: saveLock,
  satisfies: lockSatisfies,
} as const;

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  asCheckId,
  type Category,
  type Check,
  type CheckId,
  type Tier,
} from '@sentiness/check-sdk';
import type { ArtifactStore } from '../cache/artifact-store.js';
import type { ResolvedConfig } from '../config/config.js';
import type { SentinessLock } from '../lock/schema.js';

export type CheckLoadFailure = {
  readonly requestedId: CheckId;
  readonly source: string;
  readonly message: string;
};

export class CheckNotFoundError extends Error {
  constructor(id: CheckId) {
    super(`Check not found: ${id}`);
    this.name = 'CheckNotFoundError';
  }
}

export class CheckLoadError extends Error {
  constructor(
    message: string,
    readonly failure: CheckLoadFailure,
  ) {
    super(message);
    this.name = 'CheckLoadError';
  }
}

const categories: readonly Category[] = [
  'lint',
  'architecture',
  'test-quality',
  'coverage',
  'security',
  'duplication',
  'complexity',
  'platform',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isCategory(value: unknown): value is Category {
  return typeof value === 'string' && categories.includes(value as Category);
}

function isTier(value: unknown): value is Tier {
  return value === 'fast' || value === 'standard' || value === 'slow';
}

function validateCheck(value: unknown): Check {
  if (!isRecord(value)) {
    throw new Error('default export is not an object');
  }
  if (typeof value.id !== 'string') {
    throw new Error('check.id must be a string');
  }
  if (!isCategory(value.category)) {
    throw new Error('check.category is invalid');
  }
  if (!isTier(value.defaultTier)) {
    throw new Error('check.defaultTier is invalid');
  }
  if (typeof value.detect !== 'function' || typeof value.run !== 'function') {
    throw new Error('check.detect and check.run must be functions');
  }
  return value as Check;
}

function validateConfigId(id: string): CheckId {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    throw new Error(`Invalid check id "${id}"`);
  }
  return asCheckId(id);
}

async function importDefault(entryFile: string): Promise<Check> {
  const moduleValue: unknown = await import(pathToFileURL(entryFile).href);
  if (!isRecord(moduleValue) || !('default' in moduleValue)) {
    throw new Error('module has no default export');
  }
  return validateCheck(moduleValue.default);
}

// Resolve the package main of an installed @sentiness/check-<id> living in a slot.
function checkEntryFile(slotDir: string, id: string): string {
  const requireFromSlot = createRequire(join(slotDir, 'package.json'));
  return requireFromSlot.resolve(`@sentiness/check-${id}`);
}

// Resolve a package's entry file from its own package.json. Node's CommonJS
// `require.resolve` does NOT honor the `exports` field when given an absolute
// directory path (only `main`/`index.js`), and the check packages ship with
// `exports` but no `main`, so we read the manifest and resolve the `.` entry
// ourselves.
function resolvePackageEntry(pkg: Record<string, unknown>): string {
  const exportsField = pkg.exports;
  if (typeof exportsField === 'string') {
    return exportsField;
  }
  if (isRecord(exportsField)) {
    const dot = exportsField['.'];
    if (typeof dot === 'string') {
      return dot;
    }
    if (isRecord(dot)) {
      const condition = dot.default ?? dot.import ?? dot.node;
      if (typeof condition === 'string') {
        return condition;
      }
    }
  }
  if (typeof pkg.main === 'string') {
    return pkg.main;
  }
  return 'index.js';
}

// Resolve the entry file of a path-linked local check.
function linkedEntryFile(repoRoot: string, relPath: string): string {
  const pkgDir = join(repoRoot, relPath);
  const manifest: unknown = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
  if (!isRecord(manifest)) {
    throw new Error(`Invalid package.json at ${pkgDir}`);
  }
  return join(pkgDir, resolvePackageEntry(manifest));
}

export class CheckRegistry {
  private constructor(
    private readonly checks: readonly Check[],
    private readonly failures: readonly CheckLoadFailure[],
    private readonly tierOverrides: ReadonlyMap<CheckId, Tier>,
  ) {}

  static async fromResolved(
    config: ResolvedConfig,
    lock: SentinessLock,
    store: ArtifactStore,
    repoRoot: string,
  ): Promise<CheckRegistry> {
    const checks: Check[] = [];
    const failures: CheckLoadFailure[] = [];
    const tierOverrides = new Map<CheckId, Tier>();

    for (const [rawId, entry] of Object.entries(config.checks)) {
      let id: CheckId;
      try {
        id = validateConfigId(rawId);
      } catch (error) {
        failures.push({
          requestedId: asCheckId(rawId),
          source: rawId,
          message: error instanceof Error ? error.message : 'invalid check id',
        });
        continue;
      }
      if (entry.tier && isTier(entry.tier)) {
        tierOverrides.set(id, entry.tier);
      }

      try {
        if (entry.path !== undefined) {
          checks.push(await importDefault(linkedEntryFile(repoRoot, entry.path)));
          continue;
        }
        const version = lock.checks[rawId]?.version;
        const ref = { kind: 'check', id: rawId, version: version ?? '' } as const;
        if (!version || !(await store.isMaterialized(ref))) {
          failures.push({
            requestedId: id,
            source: `@sentiness/check-${rawId}`,
            message: `check "${rawId}" is not in the cache — run \`sentiness install\``,
          });
          continue;
        }
        checks.push(await importDefault(checkEntryFile(store.slotPath(ref), rawId)));
      } catch (error) {
        failures.push({
          requestedId: id,
          source: `@sentiness/check-${rawId}`,
          message: error instanceof Error ? error.message : 'unknown load error',
        });
      }
    }
    return new CheckRegistry(checks, failures, tierOverrides);
  }

  list(): readonly Check[] {
    return this.checks;
  }

  get(id: CheckId): Check | undefined {
    return this.checks.find((check) => check.id === id);
  }

  filterByTier(tier: Tier): readonly Check[] {
    return this.checks.filter(
      (check) => (this.tierOverrides.get(check.id) ?? check.defaultTier) === tier,
    );
  }

  loadFailures(): readonly CheckLoadFailure[] {
    return this.failures;
  }
}

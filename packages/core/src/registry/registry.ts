import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import {
  asCheckId,
  type Category,
  type Check,
  type CheckId,
  type Tier,
} from '@sentiness/check-sdk';
import type { ResolvedConfig } from '../config/config.js';

export type CheckLoadFailure = {
  readonly requestedId: CheckId;
  readonly moduleName: string;
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

async function importCheck(modulePath: string): Promise<Check> {
  const moduleValue: unknown = await import(pathToFileURL(modulePath).href);
  if (!isRecord(moduleValue) || !('default' in moduleValue)) {
    throw new Error('module has no default export');
  }
  return validateCheck(moduleValue.default);
}

export class CheckRegistry {
  private constructor(
    private readonly checks: readonly Check[],
    private readonly failures: readonly CheckLoadFailure[],
    private readonly tierOverrides: ReadonlyMap<CheckId, Tier>,
  ) {}

  static async fromConfig(config: ResolvedConfig, cwd: string): Promise<CheckRegistry> {
    const requireFromCwd = createRequire(`${cwd}/package.json`);
    const checks: Check[] = [];
    const failures: CheckLoadFailure[] = [];
    const tierOverrides = new Map<CheckId, Tier>();

    for (const [rawId, checkConfig] of Object.entries(config.checks)) {
      let requestedId: CheckId;
      try {
        requestedId = validateConfigId(rawId);
      } catch (error) {
        failures.push({
          requestedId: asCheckId(rawId),
          moduleName: `@sentiness/check-${rawId}`,
          message: error instanceof Error ? error.message : 'invalid check id',
        });
        continue;
      }

      if (!checkConfig.enabled) {
        continue;
      }

      if (checkConfig.tier) {
        tierOverrides.set(requestedId, checkConfig.tier);
      }

      const moduleName = `@sentiness/check-${requestedId}`;
      try {
        const modulePath = requireFromCwd.resolve(moduleName);
        checks.push(await importCheck(modulePath));
      } catch (error) {
        failures.push({
          requestedId,
          moduleName,
          message: error instanceof Error ? error.message : 'unknown check load error',
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

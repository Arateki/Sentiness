import { InMemoryFileSystem } from '@sentiness/_test-utils';
import { describe, expect, it } from 'vitest';
import {
  ConfigNotFoundError,
  ConfigParseError,
  loadConfig,
  resolveConfig,
  validateConfig,
} from './config.js';

const minimal = {
  schemaVersion: '2.0',
  engine: '2.0.0',
  checks: { biome: { version: '2.0.0' } },
};

describe('validateConfig', () => {
  it('accepts a minimal v2 config', () => {
    expect(() => validateConfig(minimal)).not.toThrow();
  });

  it('rejects a v1 schemaVersion with a migration hint', () => {
    expect(() => validateConfig({ ...minimal, schemaVersion: '1.0' })).toThrowError(
      /sentiness init/,
    );
  });

  it('rejects a catalog entry with both version and path', () => {
    expect(() =>
      validateConfig({ ...minimal, checks: { biome: { version: '2.0.0', path: 'x' } } }),
    ).toThrowError(/exactly one of/);
  });

  it('rejects a catalog entry with neither version nor path', () => {
    expect(() => validateConfig({ ...minimal, checks: { biome: {} } })).toThrowError(
      /exactly one of/,
    );
  });

  it('rejects a zone referencing an unknown check id', () => {
    expect(() =>
      validateConfig({ ...minimal, zones: [{ path: 'apps/web', checks: ['ghost'] }] }),
    ).toThrowError(/apps\/web.*ghost/);
  });

  it('rejects duplicate zone paths', () => {
    expect(() =>
      validateConfig({
        ...minimal,
        zones: [
          { path: '.', checks: ['biome'] },
          { path: '.', checks: ['biome'] },
        ],
      }),
    ).toThrowError(/duplicate zone path/i);
  });
});

describe('resolveConfig', () => {
  it('normalizes an absent zones array to a single root zone with all catalog ids', () => {
    const resolved = resolveConfig(
      validateConfig({ ...minimal, checks: { biome: { version: '1' }, knip: { version: '1' } } }),
    );
    expect(resolved.zones).toEqual([{ path: '.', checks: ['biome', 'knip'] }]);
  });

  it('keeps explicit zones', () => {
    const resolved = resolveConfig(
      validateConfig({ ...minimal, zones: [{ path: 'apps/web', checks: ['biome'] }] }),
    );
    expect(resolved.zones).toEqual([{ path: 'apps/web', checks: ['biome'] }]);
  });

  it('applies tier and reporting defaults', () => {
    const resolved = resolveConfig(validateConfig(minimal));
    expect(resolved.tiers.fast.timeoutMs).toBe(30_000);
    expect(resolved.reporting.compact).toBe(false);
    expect(resolved.baseline.path).toBe('.sentiness/baseline.json');
  });

  it('rejects a trigger appearing in two tiers', () => {
    expect(() =>
      resolveConfig(
        validateConfig({
          ...minimal,
          tiers: {
            fast: { triggers: ['pre-done'], timeoutMs: 1 },
            standard: { triggers: ['pre-done'], timeoutMs: 1 },
          },
        }),
      ),
    ).toThrowError(/appears in both/);
  });
});

describe('loadConfig', () => {
  it('throws ConfigNotFoundError when no config file exists', async () => {
    const fs = new InMemoryFileSystem();
    await expect(loadConfig('/project', fs)).rejects.toBeInstanceOf(ConfigNotFoundError);
  });

  it('loads and resolves a JSON config', async () => {
    const fs = new InMemoryFileSystem({
      '/project/sentiness.config.json': JSON.stringify(minimal),
    });
    const resolved = await loadConfig('/project', fs);
    expect(resolved.engine).toBe('2.0.0');
    expect(resolved.zones).toEqual([{ path: '.', checks: ['biome'] }]);
  });

  it('wraps invalid JSON in ConfigParseError', async () => {
    const fs = new InMemoryFileSystem({ '/project/sentiness.config.json': '{ not json' });
    await expect(loadConfig('/project', fs)).rejects.toBeInstanceOf(ConfigParseError);
  });
});

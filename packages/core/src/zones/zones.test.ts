import { asCheckId } from '@sentiness/check-sdk';
import { describe, expect, it } from 'vitest';
import { resolveConfig, type SentinessConfigV2, validateConfig } from '../config/config.js';
import { resolveZones } from './zones.js';

function makeConfig(overrides: Partial<SentinessConfigV2>): ReturnType<typeof resolveConfig> {
  return resolveConfig(
    validateConfig({
      schemaVersion: '2.0',
      engine: '2.0.0',
      checks: {},
      ...overrides,
    }),
  );
}

describe('resolveZones', () => {
  it('normalizes a single-root config to one zone at "." with every catalog check', () => {
    const config = makeConfig({
      checks: {
        biome: { version: '*', tier: 'fast' },
        knip: { version: '*', tier: 'standard' },
      },
    });

    const zones = resolveZones(config, '/repo');

    expect(zones).toHaveLength(1);
    const [root] = zones;
    expect(root?.path).toBe('.');
    expect(root?.absRoot).toBe('/repo');
    expect(root?.checks.map((c) => c.id)).toEqual([asCheckId('biome'), asCheckId('knip')]);
    expect(root?.checks.map((c) => c.tier)).toEqual(['fast', 'standard']);
  });

  it('roots each zone at repoRoot joined with the zone path', () => {
    const config = makeConfig({
      checks: { biome: { version: '*', tier: 'fast' } },
      zones: [{ path: 'apps/web', checks: ['biome'] }],
    });

    const zones = resolveZones(config, '/repo');

    expect(zones).toHaveLength(1);
    expect(zones[0]?.path).toBe('apps/web');
    expect(zones[0]?.absRoot).toBe('/repo/apps/web');
  });

  it('resolves multiple zones, each owning its own checks', () => {
    const config = makeConfig({
      checks: {
        biome: { version: '*', tier: 'fast' },
        knip: { version: '*', tier: 'standard' },
        clippy: { version: '*', tier: 'fast' },
      },
      zones: [
        { path: 'apps/web', checks: ['biome', 'knip'] },
        { path: 'crates/engine', checks: ['clippy'] },
      ],
    });

    const zones = resolveZones(config, '/repo');

    expect(zones).toHaveLength(2);
    expect(zones[0]?.checks.map((c) => c.id)).toEqual([asCheckId('biome'), asCheckId('knip')]);
    expect(zones[1]?.absRoot).toBe('/repo/crates/engine');
    expect(zones[1]?.checks.map((c) => c.id)).toEqual([asCheckId('clippy')]);
  });

  it('merges per-zone overrides over the catalog entry (zone wins; thresholds deep-merge)', () => {
    const config = makeConfig({
      checks: {
        biome: {
          version: '*',
          tier: 'fast',
          thresholds: { a: 1, b: 2 },
          extraArgs: ['--from-catalog'],
        },
      },
      zones: [
        {
          path: 'apps/web',
          checks: [{ id: 'biome', tier: 'standard', thresholds: { b: 9 } }],
        },
      ],
    });

    const [placement] = resolveZones(config, '/repo')[0]?.checks ?? [];

    expect(placement?.tier).toBe('standard');
    // thresholds deep-merge: catalog `a` survives, zone `b` overrides.
    expect(placement?.options.thresholds).toEqual({ a: 1, b: 9 });
    // catalog-only option survives.
    expect(placement?.options.extraArgs).toEqual(['--from-catalog']);
    // resolution metadata never leaks into check options.
    expect(placement?.options).not.toHaveProperty('version');
    expect(placement?.options).not.toHaveProperty('path');
    expect(placement?.options).not.toHaveProperty('tier');
  });

  it('takes the catalog tier when a zone references a check by bare id', () => {
    const config = makeConfig({
      checks: { biome: { version: '*', tier: 'slow' } },
      zones: [{ path: 'apps/web', checks: ['biome'] }],
    });

    const [placement] = resolveZones(config, '/repo')[0]?.checks ?? [];

    expect(placement?.tier).toBe('slow');
  });

  it('yields one placement per zone for a check shared across zones, with catalog options', () => {
    const config = makeConfig({
      checks: { biome: { version: '*', tier: 'fast', thresholds: { a: 1 } } },
      zones: [
        { path: 'apps/web', checks: ['biome'] },
        { path: 'apps/admin', checks: ['biome'] },
      ],
    });

    const zones = resolveZones(config, '/repo');

    expect(zones).toHaveLength(2);
    const web = zones[0]?.checks[0];
    const admin = zones[1]?.checks[0];
    expect(web?.id).toBe(asCheckId('biome'));
    expect(admin?.id).toBe(asCheckId('biome'));
    expect(web?.options).toEqual({ thresholds: { a: 1 } });
    expect(admin?.options).toEqual({ thresholds: { a: 1 } });
  });
});

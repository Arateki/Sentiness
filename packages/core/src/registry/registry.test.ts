import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { asCheckId } from '@sentiness/check-sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ArtifactStore } from '../cache/artifact-store.js';
import type { ArtifactRef, CachePaths } from '../cache/paths.js';
import { resolveConfig, validateConfig } from '../config/config.js';
import type { SentinessLock } from '../lock/schema.js';
import { CheckLoadError, CheckRegistry } from './registry.js';

let repoRoot: string;

beforeAll(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'sentiness-reg-'));
  // A path-linked check at <repoRoot>/local-check/dist/index.js
  const pkg = join(repoRoot, 'local-check');
  mkdirSync(join(pkg, 'dist'), { recursive: true });
  writeFileSync(
    join(pkg, 'package.json'),
    JSON.stringify({
      name: '@sentiness/check-demo',
      type: 'module',
      main: './dist/index.js',
      exports: { '.': './dist/index.js' },
    }),
  );
  writeFileSync(
    join(pkg, 'dist', 'index.js'),
    `export default { id: 'demo', category: 'lint', defaultTier: 'fast', detect: async () => ({ available: true }), run: async () => ({ status: 'ok', findings: [], durationMs: 0 }) };\n`,
  );
  // A path-linked package whose default export is not a valid check.
  const badPkg = join(repoRoot, 'bad-check');
  mkdirSync(join(badPkg, 'dist'), { recursive: true });
  writeFileSync(
    join(badPkg, 'package.json'),
    JSON.stringify({
      name: '@sentiness/check-bad',
      type: 'module',
      main: './dist/index.js',
      exports: { '.': './dist/index.js' },
    }),
  );
  writeFileSync(join(badPkg, 'dist', 'index.js'), `export default { id: 'bad' };\n`);
  writeFileSync(
    join(repoRoot, 'package.json'),
    JSON.stringify({ name: 'repo-root', private: true }),
  );
});

afterAll(() => rmSync(repoRoot, { recursive: true, force: true }));

// A store stub: every check is "materialized" and its slot is the fixture dir.
function stubStore(slot: string): ArtifactStore {
  const paths: Pick<CachePaths, 'slotPath'> = { slotPath: () => slot };
  return {
    slotPath: (ref: ArtifactRef) => paths.slotPath(ref),
    isMaterialized: async () => true,
    materialize: async () => ({ path: slot, integrity: '' }),
  };
}

const emptyLock: SentinessLock = { lockfileVersion: 1, engine: { version: '2.0.0' }, checks: {} };

describe('CheckRegistry.fromResolved', () => {
  it('loads a path-linked check from a local package', async () => {
    const config = resolveConfig(
      validateConfig({
        schemaVersion: '2.0',
        engine: '2.0.0',
        checks: { demo: { path: 'local-check' } },
      }),
    );
    const registry = await CheckRegistry.fromResolved(
      config,
      emptyLock,
      stubStore('/unused'),
      repoRoot,
    );
    expect(registry.list().map((c) => c.id)).toEqual(['demo']);
    expect(registry.loadFailures()).toHaveLength(0);
  });

  it('honors a per-check tier override', async () => {
    const config = resolveConfig(
      validateConfig({
        schemaVersion: '2.0',
        engine: '2.0.0',
        checks: { demo: { path: 'local-check', tier: 'slow' } },
      }),
    );
    const registry = await CheckRegistry.fromResolved(
      config,
      emptyLock,
      stubStore('/unused'),
      repoRoot,
    );
    expect(registry.filterByTier('slow').map((c) => c.id)).toEqual(['demo']);
    expect(registry.filterByTier('fast')).toEqual([]);
  });

  it('records a load failure for an invalid check id', async () => {
    const config = resolveConfig(
      validateConfig({
        schemaVersion: '2.0',
        engine: '2.0.0',
        checks: { BadId: { path: 'local-check' } },
      }),
    );
    const registry = await CheckRegistry.fromResolved(
      config,
      emptyLock,
      stubStore('/unused'),
      repoRoot,
    );
    expect(registry.list()).toHaveLength(0);
    expect(registry.loadFailures()[0]?.message).toMatch(/Invalid check id/);
  });

  it('records a load failure when a path-linked check default export is invalid', async () => {
    const config = resolveConfig(
      validateConfig({
        schemaVersion: '2.0',
        engine: '2.0.0',
        checks: { bad: { path: 'bad-check' } },
      }),
    );
    const registry = await CheckRegistry.fromResolved(
      config,
      emptyLock,
      stubStore('/unused'),
      repoRoot,
    );
    expect(registry.list()).toHaveLength(0);
    expect(registry.loadFailures()[0]?.message).toMatch(/category is invalid/);
  });

  it('records a load failure when a versioned check slot is not materialized', async () => {
    const config = resolveConfig(
      validateConfig({
        schemaVersion: '2.0',
        engine: '2.0.0',
        checks: { biome: { version: '1.3.0' } },
      }),
    );
    const notMaterialized: ArtifactStore = {
      ...stubStore('/none'),
      isMaterialized: async () => false,
    };
    const lock: SentinessLock = {
      lockfileVersion: 1,
      engine: { version: '2.0.0' },
      checks: { biome: { version: '1.3.0' } },
    };
    const registry = await CheckRegistry.fromResolved(config, lock, notMaterialized, repoRoot);
    expect(registry.list()).toHaveLength(0);
    expect(registry.loadFailures()[0]?.message).toMatch(/sentiness install/);
  });

  it('get returns a loaded check and undefined for an unknown id', async () => {
    const config = resolveConfig(
      validateConfig({
        schemaVersion: '2.0',
        engine: '2.0.0',
        checks: { demo: { path: 'local-check' } },
      }),
    );
    const registry = await CheckRegistry.fromResolved(
      config,
      emptyLock,
      stubStore('/unused'),
      repoRoot,
    );
    expect(registry.get(asCheckId('demo'))).toBeDefined();
    expect(registry.get(asCheckId('nope'))).toBeUndefined();
  });

  it('exposes the CheckLoadError class', () => {
    const error = new CheckLoadError('msg', {
      requestedId: asCheckId('foo'),
      source: 'bar',
      message: 'err',
    });
    expect(error.name).toBe('CheckLoadError');
    expect(error.failure.source).toBe('bar');
  });
});

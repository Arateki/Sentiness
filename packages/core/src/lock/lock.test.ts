import { InMemoryFileSystem } from '@sentiness/_test-utils';
import { describe, expect, it } from 'vitest';
import { resolveConfig, validateConfig } from '../config/config.js';
import { LockManager, LockParseError } from './lock.js';
import type { SentinessLock } from './schema.js';

const lock: SentinessLock = {
  lockfileVersion: 1,
  engine: { version: '2.0.0' },
  checks: { knip: { version: '1.0.0' }, biome: { version: '1.3.0' } },
};

const config = resolveConfig(
  validateConfig({
    schemaVersion: '2.0',
    engine: '2.0.0',
    checks: { biome: { version: '^1.3.0' }, knip: { version: '^1.0.0' } },
  }),
);

describe('LockManager', () => {
  it('returns undefined when the lock file is absent', async () => {
    expect(await LockManager.load('/p/sentiness.lock', new InMemoryFileSystem())).toBeUndefined();
  });

  it('save then load is identity, with check keys sorted', async () => {
    const fs = new InMemoryFileSystem();
    await LockManager.save('/p/sentiness.lock', lock, fs);
    const text = await fs.readFile('/p/sentiness.lock');
    expect(text.indexOf('"biome"')).toBeLessThan(text.indexOf('"knip"'));
    expect(await LockManager.load('/p/sentiness.lock', fs)).toEqual(lock);
  });

  it('throws LockParseError on malformed JSON', async () => {
    const fs = new InMemoryFileSystem({ '/p/sentiness.lock': '{ broken' });
    await expect(LockManager.load('/p/sentiness.lock', fs)).rejects.toBeInstanceOf(LockParseError);
  });

  it('satisfies: ok when engine and every check match', () => {
    expect(LockManager.satisfies(lock, config).ok).toBe(true);
  });

  it('satisfies: reports engine drift', () => {
    const result = LockManager.satisfies({ ...lock, engine: { version: '1.9.0' } }, config);
    expect(result.ok).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/engine/);
  });

  it('satisfies: reports a missing check', () => {
    const result = LockManager.satisfies(
      { ...lock, checks: { biome: { version: '1.3.0' } } },
      config,
    );
    expect(result.ok).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/knip/);
  });

  it('satisfies: a path-linked catalog entry matches a path lock entry', () => {
    const linkedConfig = resolveConfig(
      validateConfig({
        schemaVersion: '2.0',
        engine: '2.0.0',
        checks: { biome: { path: 'packages/checks/biome' } },
      }),
    );
    const linkedLock: SentinessLock = {
      lockfileVersion: 1,
      engine: { version: '2.0.0' },
      checks: { biome: { path: 'packages/checks/biome' } },
    };
    expect(LockManager.satisfies(linkedLock, linkedConfig).ok).toBe(true);
  });
});

import { rangeSatisfied } from './lock.js';

describe('rangeSatisfied', () => {
  it.each([
    ['1.2.3', '1.2.3', true],
    ['^1.2.0', '1.5.0', true],
    ['^1.2.0', '2.0.0', false],
    ['~1.2.0', '1.2.9', true],
    ['~1.2.0', '1.3.0', false],
    ['*', '9.9.9', true],
    ['^1.0.0', '', false],
  ])('range %s vs version %s => %s', (range, version, expected) => {
    expect(rangeSatisfied(range, version)).toBe(expected);
  });
});

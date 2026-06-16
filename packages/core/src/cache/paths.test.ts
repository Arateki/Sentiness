import { describe, expect, it } from 'vitest';
import { createCachePaths } from './paths.js';

describe('createCachePaths', () => {
  const paths = createCachePaths('/home/u/.sentiness');

  it('places engine slots under cache/engine/<version>', () => {
    expect(paths.slotPath({ kind: 'engine', id: 'core', version: '2.0.0' })).toBe(
      '/home/u/.sentiness/cache/engine/2.0.0',
    );
  });

  it('places check slots under cache/checks/<id>/<version>', () => {
    expect(paths.slotPath({ kind: 'check', id: 'biome', version: '1.3.0' })).toBe(
      '/home/u/.sentiness/cache/checks/biome/1.3.0',
    );
  });

  it('exposes a tmp dir under the cache root', () => {
    expect(paths.tmpDir()).toBe('/home/u/.sentiness/cache/tmp');
  });
});

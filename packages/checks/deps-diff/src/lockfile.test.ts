import { describe, expect, it } from 'vitest';
import { parseLockfile, parseNpmLockfile } from './lockfile.js';

describe('parseNpmLockfile', () => {
  it('extracts hoisted versions from package-lock.json v3', () => {
    const content = JSON.stringify({
      name: 'demo',
      lockfileVersion: 3,
      packages: {
        '': { name: 'demo', version: '0.0.0' },
        'node_modules/foo': { version: '1.2.3' },
        'node_modules/@scope/bar': { version: '4.5.6' },
        'node_modules/foo/node_modules/baz': { version: '0.1.0' },
      },
    });

    const versions = parseNpmLockfile(content);

    expect(versions?.get('foo')).toBe('1.2.3');
    expect(versions?.get('@scope/bar')).toBe('4.5.6');
    expect(versions?.get('baz')).toBe('0.1.0');
    expect(versions?.has('')).toBe(false);
  });

  it('returns undefined for malformed JSON', () => {
    expect(parseNpmLockfile('not json')).toBeUndefined();
  });

  it('returns undefined when packages is missing', () => {
    expect(parseNpmLockfile(JSON.stringify({ lockfileVersion: 3 }))).toBeUndefined();
  });
});

describe('parseLockfile', () => {
  it('routes package-lock to the npm parser', () => {
    const content = JSON.stringify({
      lockfileVersion: 3,
      packages: { 'node_modules/foo': { version: '1.0.0' } },
    });
    expect(parseLockfile('package-lock', content)?.get('foo')).toBe('1.0.0');
  });

  it('returns undefined for unsupported lockfile kinds', () => {
    expect(parseLockfile('pnpm-lock', '')).toBeUndefined();
    expect(parseLockfile('yarn-lock', '')).toBeUndefined();
  });
});

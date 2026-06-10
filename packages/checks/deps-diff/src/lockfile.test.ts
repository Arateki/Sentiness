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

  it('skips entries without a node_modules path or version and keeps the hoisted version', () => {
    const content = JSON.stringify({
      lockfileVersion: 3,
      packages: {
        '': { version: '0.0.0' },
        'packages/local-workspace': { version: '1.0.0' },
        'node_modules/': { version: '1.0.0' },
        'node_modules/no-version': {},
        'node_modules/@scope': { version: '9.9.9' },
        'node_modules/foo': { version: '1.0.0' },
        'node_modules/bar/node_modules/foo': { version: '2.0.0' },
      },
    });

    const versions = parseNpmLockfile(content);

    expect(versions?.get('foo')).toBe('1.0.0');
    expect(versions?.get('@scope')).toBe('9.9.9');
    expect(versions?.has('no-version')).toBe(false);
    expect(versions?.has('local-workspace')).toBe(false);
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

  it('routes pnpm-lock to the pnpm parser', () => {
    const content = "lockfileVersion: '9.0'\n\npackages:\n\n  foo@1.0.0:\n    resolution: {}\n";
    expect(parseLockfile('pnpm-lock', content)?.get('foo')).toBe('1.0.0');
  });

  it('routes yarn-lock to the yarn parser', () => {
    const content = 'foo@^1.0.0:\n  version "1.0.0"\n';
    expect(parseLockfile('yarn-lock', content)?.get('foo')).toBe('1.0.0');
  });

  it('returns undefined for malformed content of any kind', () => {
    expect(parseLockfile('package-lock', 'not json')).toBeUndefined();
    expect(parseLockfile('pnpm-lock', '')).toBeUndefined();
    expect(parseLockfile('yarn-lock', '')).toBeUndefined();
  });
});

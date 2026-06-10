import { describe, expect, it } from 'vitest';
import { parsePnpmLockfile } from './pnpm-lockfile.js';

const V9_LOCKFILE = `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false

importers:

  .:
    dependencies:
      foo:
        specifier: ^1.0.0
        version: 1.2.3

packages:

  '@scope/bar@4.5.6':
    resolution: {integrity: sha512-aaa}

  foo@1.2.3:
    resolution: {integrity: sha512-bbb}

  my_lib@2.0.0:
    resolution: {integrity: sha512-ccc}

snapshots:

  '@scope/bar@4.5.6(peer@1.0.0)':
    dependencies:
      foo: 1.2.3
`;

const V6_LOCKFILE = `lockfileVersion: '6.0'

dependencies:
  foo:
    specifier: ^1.0.0
    version: 1.2.3

packages:

  /@scope/bar@4.5.6(peer@1.0.0):
    resolution: {integrity: sha512-aaa}
    dev: false

  /foo@1.2.3:
    resolution: {integrity: sha512-bbb}
`;

const V5_LOCKFILE = `lockfileVersion: 5.4

specifiers:
  foo: ^1.0.0

packages:

  /@scope/bar/4.5.6_peer@1.0.0:
    resolution: {integrity: sha512-aaa}

  /foo/1.2.3:
    resolution: {integrity: sha512-bbb}
`;

describe('parsePnpmLockfile', () => {
  it('extracts package versions from a v9 lockfile', () => {
    const versions = parsePnpmLockfile(V9_LOCKFILE);

    expect(versions?.get('foo')).toBe('1.2.3');
    expect(versions?.get('@scope/bar')).toBe('4.5.6');
    expect(versions?.get('my_lib')).toBe('2.0.0');
    expect(versions?.size).toBe(3);
  });

  it('extracts package versions from a v6 lockfile, stripping peer suffixes', () => {
    const versions = parsePnpmLockfile(V6_LOCKFILE);

    expect(versions?.get('foo')).toBe('1.2.3');
    expect(versions?.get('@scope/bar')).toBe('4.5.6');
    expect(versions?.size).toBe(2);
  });

  it('extracts package versions from a v5 lockfile, stripping peer suffixes', () => {
    const versions = parsePnpmLockfile(V5_LOCKFILE);

    expect(versions?.get('foo')).toBe('1.2.3');
    expect(versions?.get('@scope/bar')).toBe('4.5.6');
    expect(versions?.size).toBe(2);
  });

  it('returns undefined when there is no packages section', () => {
    expect(parsePnpmLockfile("lockfileVersion: '9.0'\n")).toBeUndefined();
    expect(parsePnpmLockfile('')).toBeUndefined();
    expect(parsePnpmLockfile('not a lockfile at all')).toBeUndefined();
  });

  it('returns undefined for unsupported lockfile versions', () => {
    expect(parsePnpmLockfile('lockfileVersion: 3\n\npackages:\n\n  /foo/1.0.0:\n')).toBeUndefined();
  });

  it('ignores keys that do not match the lockfile version format', () => {
    const v9WithJunk = [
      "lockfileVersion: '9.0'",
      '',
      'packages:',
      '',
      '  no-version-marker:',
      '    resolution: {}',
      '',
      '  foo@1.0.0:',
      '    resolution: {}',
      '',
    ].join('\n');
    expect(parsePnpmLockfile(v9WithJunk)?.size).toBe(1);

    const v6WithJunk = [
      "lockfileVersion: '6.0'",
      '',
      'packages:',
      '',
      '  missing-leading-slash@1.0.0:',
      '    resolution: {}',
      '',
      '  /foo@1.0.0:',
      '    resolution: {}',
      '',
    ].join('\n');
    expect(parsePnpmLockfile(v6WithJunk)?.size).toBe(1);

    const v5WithJunk = [
      'lockfileVersion: 5.4',
      '',
      'packages:',
      '',
      '  /noslashversion:',
      '    resolution: {}',
      '',
      '  /foo/1.0.0:',
      '    resolution: {}',
      '',
    ].join('\n');
    expect(parsePnpmLockfile(v5WithJunk)?.size).toBe(1);
  });
});

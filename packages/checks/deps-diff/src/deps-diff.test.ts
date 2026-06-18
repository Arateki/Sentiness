import {
  FakeProcessRunner,
  InMemoryFileSystem,
  InMemoryGitProvider,
  SilentLogger,
} from '@sentiness/_test-utils';
import type { CheckContext } from '@sentiness/check-sdk';
import { describe, expect, it } from 'vitest';
import { depsDiffCheck } from './deps-diff.js';

function context(fs: InMemoryFileSystem, git?: InMemoryGitProvider): CheckContext {
  return {
    cwd: '/project',
    repoRoot: '/project',
    tier: 'fast',
    trigger: null,
    baseRef: 'main',
    changedFiles: [],
    changedRanges: new Map(),
    diffOnly: false,
    signal: new AbortController().signal,
    logger: new SilentLogger(),
    fs,
    ...(git ? { git } : {}),
    process: new FakeProcessRunner(),
    checkConfig: { enabled: true },
  };
}

describe('depsDiffCheck', () => {
  it('detects package.json availability', async () => {
    const fs = new InMemoryFileSystem({ '/project/package.json': '{}' });
    await expect(depsDiffCheck.detect(context(fs))).resolves.toEqual({ available: true });
  });

  it('reports added, removed, and major-bumped direct dependencies', async () => {
    const fs = new InMemoryFileSystem({
      '/project/package.json': JSON.stringify(
        {
          dependencies: { react: '^19.0.0', zod: '^4.0.0' },
          devDependencies: { vitest: '^3.0.0' },
        },
        null,
        2,
      ),
    });
    const git = new InMemoryGitProvider();
    git.files.set(
      'main:package.json',
      JSON.stringify(
        {
          dependencies: { react: '^18.0.0', lodash: '^4.0.0' },
          devDependencies: { vitest: '^3.0.0' },
        },
        null,
        2,
      ),
    );

    const result = await depsDiffCheck.run(context(fs, git));

    expect(result.status).toBe('violations');
    expect(result.metrics?.transitiveDiffAvailable).toBe(false);
    expect(result.findings.map((finding) => finding.ruleId).sort()).toEqual([
      'major-version-bump',
      'new-dependency',
      'removed-dependency',
    ]);
    expect(
      result.findings.find((finding) => finding.ruleId === 'new-dependency')?.location,
    ).toMatchObject({
      file: 'package.json',
      packageName: 'zod',
      packageVersion: '^4.0.0',
    });
    expect(result.findings.every((finding) => /^[a-f0-9]{64}$/.test(finding.fingerprint))).toBe(
      true,
    );
  });

  it('returns an error when the Git provider is missing', async () => {
    const fs = new InMemoryFileSystem({ '/project/package.json': '{}' });

    const result = await depsDiffCheck.run(context(fs));

    expect(result.status).toBe('error');
    expect(result.errorMessage).toContain('Git provider');
  });

  it('reports transitive changes from package-lock.json and flips transitiveDiffAvailable', async () => {
    const currentPackage = JSON.stringify({ dependencies: { foo: '^2.0.0' } }, null, 2);
    const basePackage = JSON.stringify({ dependencies: { foo: '^2.0.0' } }, null, 2);
    const currentLock = JSON.stringify({
      lockfileVersion: 3,
      packages: {
        '': { name: 'demo', version: '0.0.0' },
        'node_modules/foo': { version: '2.0.0' },
        'node_modules/leftpad': { version: '3.0.0' },
        'node_modules/legacy': { version: '5.0.0' },
      },
    });
    const baseLock = JSON.stringify({
      lockfileVersion: 3,
      packages: {
        '': { name: 'demo', version: '0.0.0' },
        'node_modules/foo': { version: '2.0.0' },
        'node_modules/leftpad': { version: '2.0.0' },
        'node_modules/oldlib': { version: '1.0.0' },
      },
    });
    const fs = new InMemoryFileSystem({
      '/project/package.json': currentPackage,
      '/project/package-lock.json': currentLock,
    });
    const git = new InMemoryGitProvider();
    git.files.set('main:package.json', basePackage);
    git.files.set('main:package-lock.json', baseLock);

    const result = await depsDiffCheck.run(context(fs, git));

    expect(result.metrics?.transitiveDiffAvailable).toBe(true);
    const transitive = result.findings.filter(
      (finding) =>
        String(finding.ruleId).endsWith('-transitive') ||
        String(finding.ruleId).startsWith('new-transitive') ||
        String(finding.ruleId).startsWith('removed-transitive'),
    );
    const byRule = new Map(transitive.map((finding) => [finding.ruleId, finding]));
    expect(byRule.get('new-transitive-dependency')?.location).toMatchObject({
      file: 'package-lock.json',
      packageName: 'legacy',
      packageVersion: '5.0.0',
    });
    expect(byRule.get('removed-transitive-dependency')?.location).toMatchObject({
      packageName: 'oldlib',
    });
    expect(byRule.get('major-version-bump-transitive')?.message).toContain('leftpad');
    expect(transitive.every((finding) => finding.severity === 'info')).toBe(true);
    expect(transitive.every((finding) => /^[a-f0-9]{64}$/.test(finding.fingerprint))).toBe(true);
  });

  it('does not double-report a direct dependency as transitive', async () => {
    const currentPackage = JSON.stringify({ dependencies: { foo: '^2.0.0' } });
    const basePackage = JSON.stringify({ dependencies: {} });
    const currentLock = JSON.stringify({
      lockfileVersion: 3,
      packages: {
        '': { version: '0.0.0' },
        'node_modules/foo': { version: '2.0.0' },
      },
    });
    const baseLock = JSON.stringify({
      lockfileVersion: 3,
      packages: { '': { version: '0.0.0' } },
    });
    const fs = new InMemoryFileSystem({
      '/project/package.json': currentPackage,
      '/project/package-lock.json': currentLock,
    });
    const git = new InMemoryGitProvider();
    git.files.set('main:package.json', basePackage);
    git.files.set('main:package-lock.json', baseLock);

    const result = await depsDiffCheck.run(context(fs, git));

    const ruleIds = result.findings.map((finding) => String(finding.ruleId));
    expect(ruleIds).toContain('new-dependency');
    expect(ruleIds).not.toContain('new-transitive-dependency');
  });

  it('reports transitive changes from pnpm-lock.yaml', async () => {
    const pkg = JSON.stringify({ dependencies: { foo: '^1.0.0' } });
    const currentLock = [
      "lockfileVersion: '9.0'",
      '',
      'packages:',
      '',
      '  foo@1.0.0:',
      '    resolution: {integrity: sha512-aaa}',
      '',
      '  leftpad@3.0.0:',
      '    resolution: {integrity: sha512-bbb}',
      '',
    ].join('\n');
    const baseLock = [
      "lockfileVersion: '9.0'",
      '',
      'packages:',
      '',
      '  foo@1.0.0:',
      '    resolution: {integrity: sha512-aaa}',
      '',
      '  leftpad@2.0.0:',
      '    resolution: {integrity: sha512-ccc}',
      '',
    ].join('\n');
    const fs = new InMemoryFileSystem({
      '/project/package.json': pkg,
      '/project/pnpm-lock.yaml': currentLock,
    });
    const git = new InMemoryGitProvider();
    git.files.set('main:package.json', pkg);
    git.files.set('main:pnpm-lock.yaml', baseLock);

    const result = await depsDiffCheck.run(context(fs, git));

    expect(result.metrics?.transitiveDiffAvailable).toBe(true);
    const bump = result.findings.find(
      (finding) => finding.ruleId === 'major-version-bump-transitive',
    );
    expect(bump?.location).toMatchObject({ file: 'pnpm-lock.yaml', packageName: 'leftpad' });
  });

  it('reports transitive changes from yarn.lock', async () => {
    const pkg = JSON.stringify({ dependencies: { foo: '^1.0.0' } });
    const currentLock = 'foo@^1.0.0:\n  version "1.0.0"\n\nleftpad@^3.0.0:\n  version "3.0.0"\n';
    const baseLock = 'foo@^1.0.0:\n  version "1.0.0"\n';
    const fs = new InMemoryFileSystem({
      '/project/package.json': pkg,
      '/project/yarn.lock': currentLock,
    });
    const git = new InMemoryGitProvider();
    git.files.set('main:package.json', pkg);
    git.files.set('main:yarn.lock', baseLock);

    const result = await depsDiffCheck.run(context(fs, git));

    expect(result.metrics?.transitiveDiffAvailable).toBe(true);
    const added = result.findings.find((finding) => finding.ruleId === 'new-transitive-dependency');
    expect(added?.location).toMatchObject({
      file: 'yarn.lock',
      packageName: 'leftpad',
      packageVersion: '3.0.0',
    });
  });

  it('keeps transitiveDiffAvailable false when the lockfile is absent', async () => {
    const fs = new InMemoryFileSystem({
      '/project/package.json': JSON.stringify({ dependencies: { foo: '^1.0.0' } }),
    });
    const git = new InMemoryGitProvider();
    git.files.set('main:package.json', JSON.stringify({ dependencies: {} }));

    const result = await depsDiffCheck.run(context(fs, git));

    expect(result.metrics?.transitiveDiffAvailable).toBe(false);
  });
});

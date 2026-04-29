import { InMemoryFileSystem } from '@sentiness/_test-utils';
import { describe, expect, it } from 'vitest';
import { detectPackageMetadata, PackageMetadataError } from './package-metadata.js';

describe('package-metadata', () => {
  it('returns default when no package.json exists', async () => {
    const fs = new InMemoryFileSystem();
    const metadata = await detectPackageMetadata('/project', fs);
    expect(metadata.packageJsonPath).toBeNull();
    expect(metadata.packageManager).toBe('unknown');
    expect(metadata.hookManagers).toEqual([]);
    expect(metadata.lockfiles).toEqual([]);
    expect(metadata.dependencies).toEqual({});
  });

  it('detects packageManager from lockfiles', async () => {
    const fs = new InMemoryFileSystem({
      '/project/yarn.lock': '',
    });
    const metadata = await detectPackageMetadata('/project', fs);
    expect(metadata.packageManager).toBe('yarn');
    expect(metadata.lockfiles).toHaveLength(1);
    expect(metadata.lockfiles[0]?.kind).toBe('yarn-lock');
  });

  it('detects packageManager from packageManager field if no known lockfile', async () => {
    const fs = new InMemoryFileSystem({
      '/project/package.json': JSON.stringify({
        packageManager: 'pnpm@8.0.0',
        dependencies: { foo: '1.0' },
      }),
    });
    const metadata = await detectPackageMetadata('/project', fs);
    expect(metadata.packageManager).toBe('pnpm');
    expect(metadata.dependencies).toEqual({ foo: '1.0' });
  });

  it('prefers lockfile over packageManager field', async () => {
    const fs = new InMemoryFileSystem({
      '/project/package.json': JSON.stringify({
        packageManager: 'npm@10.0.0',
      }),
      '/project/pnpm-lock.yaml': '',
    });
    const metadata = await detectPackageMetadata('/project', fs);
    expect(metadata.packageManager).toBe('pnpm');
  });

  it('detects npm from package-lock.json', async () => {
    const fs = new InMemoryFileSystem({
      '/project/package.json': JSON.stringify({}),
      '/project/package-lock.json': '',
    });
    const metadata = await detectPackageMetadata('/project', fs);
    expect(metadata.packageManager).toBe('npm');
  });

  it('detects known hook managers from package metadata', async () => {
    const fs = new InMemoryFileSystem({
      '/project/package.json': JSON.stringify({
        devDependencies: { husky: '^9.0.0', lefthook: '^1.0.0' },
        'simple-git-hooks': { 'pre-commit': 'pnpm test' },
      }),
    });

    const metadata = await detectPackageMetadata('/project', fs);

    expect(metadata.hookManagers).toEqual(['husky', 'lefthook', 'simple-git-hooks']);
  });

  it('throws PackageMetadataError on invalid JSON', async () => {
    const fs = new InMemoryFileSystem({
      '/project/package.json': 'invalid json',
    });
    await expect(detectPackageMetadata('/project', fs)).rejects.toThrow(PackageMetadataError);
  });
});

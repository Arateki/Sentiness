import {
  FixedClock,
  InMemoryFileSystem,
  InMemoryGitProvider,
  SilentLogger,
} from '@sentiness/_test-utils';
import { describe, expect, it, vi } from 'vitest';
import { installHooksCommand } from './install-hooks.js';
import type { CommandDeps } from './types.js';

describe('installHooksCommand', () => {
  function depsFor(fs: InMemoryFileSystem, git: InMemoryGitProvider): CommandDeps {
    return {
      cwd: '/project',
      fs,
      logger: new SilentLogger(),
      clock: new FixedClock(0),
      git,
      processRunner: {} as unknown as import('@sentiness/check-sdk').ProcessRunner,
      stdout: { write: vi.fn() },
    };
  }

  it('installs pre-commit hook successfully', async () => {
    const fs = new InMemoryFileSystem({
      '/project/package.json': JSON.stringify({ packageManager: 'pnpm@10.0.0' }),
      '/project/pnpm-lock.yaml': '',
    });
    const git = new InMemoryGitProvider();
    git.isRepo = vi.fn().mockResolvedValue(true);

    const deps = depsFor(fs, git);

    const exitCode = await installHooksCommand({}, deps);
    expect(exitCode).toBe(0);

    const hookExists = await fs.exists('/project/.git/hooks/pre-commit');
    expect(hookExists).toBe(true);

    const hookContent = await fs.readFile('/project/.git/hooks/pre-commit');
    expect(hookContent).toContain('pnpm exec sentiness check --tier=fast --trigger=pre-commit');
    expect(hookContent).toContain('# sentiness:start');
  });

  it('installs pre-push hook if requested', async () => {
    const fs = new InMemoryFileSystem({
      '/project/package.json': JSON.stringify({ packageManager: 'npm@10.0.0' }),
      '/project/package-lock.json': '',
    });
    const git = new InMemoryGitProvider();
    git.isRepo = vi.fn().mockResolvedValue(true);

    const deps = depsFor(fs, git);

    await installHooksCommand({ push: true }, deps);
    expect(await fs.exists('/project/.git/hooks/pre-push')).toBe(true);
    expect(await fs.readFile('/project/.git/hooks/pre-push')).toContain(
      'npx sentiness check --tier=slow --trigger=pre-push',
    );
  });

  it('backs up an existing unmanaged hook', async () => {
    const fs = new InMemoryFileSystem({
      '/project/package.json': JSON.stringify({ packageManager: 'pnpm@10.0.0' }),
      '/project/pnpm-lock.yaml': '',
      '/project/.git/hooks/pre-commit': '#!/bin/sh\necho existing\n',
    });
    const git = new InMemoryGitProvider();
    git.isRepo = vi.fn().mockResolvedValue(true);

    await installHooksCommand({}, depsFor(fs, git));

    expect(await fs.readFile('/project/.git/hooks/pre-commit.bak')).toContain('echo existing');
    expect(await fs.readFile('/project/.git/hooks/pre-commit')).toContain('# sentiness:start');
  });

  it('updates an existing managed direct hook without duplicating the block', async () => {
    const fs = new InMemoryFileSystem({
      '/project/package.json': JSON.stringify({ packageManager: 'pnpm@10.0.0' }),
      '/project/pnpm-lock.yaml': '',
      '/project/.git/hooks/pre-commit':
        '#!/bin/sh\n# sentiness:start\nold command\n# sentiness:end\n',
    });
    const git = new InMemoryGitProvider();
    git.isRepo = vi.fn().mockResolvedValue(true);

    await installHooksCommand({}, depsFor(fs, git));

    const hook = await fs.readFile('/project/.git/hooks/pre-commit');
    expect(hook.match(/sentiness:start/g)).toHaveLength(1);
    expect(hook).toContain('pnpm exec sentiness check --tier=fast --trigger=pre-commit');
  });

  it('installs through Husky when detected', async () => {
    const fs = new InMemoryFileSystem({
      '/project/package.json': JSON.stringify({
        packageManager: 'pnpm@10.0.0',
        devDependencies: { husky: '^9.0.0' },
      }),
      '/project/.husky/pre-commit': '#!/usr/bin/env sh\npnpm lint\n',
    });
    const git = new InMemoryGitProvider();
    git.isRepo = vi.fn().mockResolvedValue(true);

    await installHooksCommand({}, depsFor(fs, git));

    const hook = await fs.readFile('/project/.husky/pre-commit');
    expect(hook).toContain('pnpm lint');
    expect(hook).toContain('pnpm exec sentiness check --tier=fast --trigger=pre-commit');
    expect(await fs.exists('/project/.git/hooks/pre-commit')).toBe(false);
  });

  it('installs through simple-git-hooks when detected', async () => {
    const fs = new InMemoryFileSystem({
      '/project/package.json': JSON.stringify({
        packageManager: 'npm@10.0.0',
        devDependencies: { 'simple-git-hooks': '^2.0.0' },
        'simple-git-hooks': { 'pre-commit': 'npm test' },
      }),
      '/project/package-lock.json': '',
    });
    const git = new InMemoryGitProvider();
    git.isRepo = vi.fn().mockResolvedValue(true);

    await installHooksCommand({ push: true }, depsFor(fs, git));

    const packageJson = JSON.parse(await fs.readFile('/project/package.json'));
    expect(packageJson['simple-git-hooks']['pre-commit']).toContain('npm test');
    expect(packageJson['simple-git-hooks']['pre-commit']).toContain(
      'npx sentiness check --tier=fast --trigger=pre-commit',
    );
    expect(packageJson['simple-git-hooks']['pre-push']).toContain(
      'npx sentiness check --tier=slow --trigger=pre-push',
    );
  });

  it('installs through Lefthook when detected', async () => {
    const fs = new InMemoryFileSystem({
      '/project/package.json': JSON.stringify({
        packageManager: 'yarn@4.0.0',
        devDependencies: { lefthook: '^1.0.0' },
      }),
      '/project/yarn.lock': '',
    });
    const git = new InMemoryGitProvider();
    git.isRepo = vi.fn().mockResolvedValue(true);

    await installHooksCommand({}, depsFor(fs, git));

    const config = await fs.readFile('/project/lefthook.yml');
    expect(config).toContain('pre-commit:');
    expect(config).toContain('run: yarn sentiness check --tier=fast --trigger=pre-commit');
  });

  it('uses lefthook-local.yml when an existing Lefthook section would be duplicated', async () => {
    const fs = new InMemoryFileSystem({
      '/project/package.json': JSON.stringify({
        packageManager: 'pnpm@10.0.0',
        devDependencies: { lefthook: '^1.0.0' },
      }),
      '/project/pnpm-lock.yaml': '',
      '/project/lefthook.yml': 'pre-commit:\n  commands:\n    lint:\n      run: pnpm lint\n',
    });
    const git = new InMemoryGitProvider();
    git.isRepo = vi.fn().mockResolvedValue(true);

    await installHooksCommand({}, depsFor(fs, git));

    expect(await fs.readFile('/project/lefthook.yml')).toContain('run: pnpm lint');
    const localConfig = await fs.readFile('/project/lefthook-local.yml');
    expect(localConfig).toContain(
      'run: pnpm exec sentiness check --tier=fast --trigger=pre-commit',
    );
  });

  it('fails if not a git repository', async () => {
    const fs = new InMemoryFileSystem();
    const git = new InMemoryGitProvider();
    git.isRepo = vi.fn().mockResolvedValue(false);

    const deps = depsFor(fs, git);

    const exitCode = await installHooksCommand({}, deps);
    expect(exitCode).toBe(1);
  });
});

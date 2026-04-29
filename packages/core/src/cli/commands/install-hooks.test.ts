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
  it('installs pre-commit hook successfully', async () => {
    const fs = new InMemoryFileSystem();
    const git = new InMemoryGitProvider();
    git.isRepo = vi.fn().mockResolvedValue(true);

    const deps: CommandDeps = {
      cwd: '/project',
      fs,
      logger: new SilentLogger(),
      clock: new FixedClock(0),
      git,
      processRunner: {} as unknown as import('@sentiness/check-sdk').ProcessRunner,
      stdout: { write: vi.fn() },
    };

    const exitCode = await installHooksCommand({}, deps);
    expect(exitCode).toBe(0);

    const hookExists = await fs.exists('/project/.git/hooks/pre-commit');
    expect(hookExists).toBe(true);

    const hookContent = await fs.readFile('/project/.git/hooks/pre-commit');
    expect(hookContent).toContain('sentiness check --tier=fast');
  });

  it('installs pre-push hook if requested', async () => {
    const fs = new InMemoryFileSystem();
    const git = new InMemoryGitProvider();
    git.isRepo = vi.fn().mockResolvedValue(true);

    const deps: CommandDeps = {
      cwd: '/project',
      fs,
      logger: new SilentLogger(),
      clock: new FixedClock(0),
      git,
      processRunner: {} as unknown as import('@sentiness/check-sdk').ProcessRunner,
      stdout: { write: vi.fn() },
    };

    await installHooksCommand({ push: true }, deps);
    expect(await fs.exists('/project/.git/hooks/pre-push')).toBe(true);
  });

  it('fails if not a git repository', async () => {
    const fs = new InMemoryFileSystem();
    const git = new InMemoryGitProvider();
    git.isRepo = vi.fn().mockResolvedValue(false);

    const deps: CommandDeps = {
      cwd: '/project',
      fs,
      logger: new SilentLogger(),
      clock: new FixedClock(0),
      git,
      processRunner: {} as unknown as import('@sentiness/check-sdk').ProcessRunner,
      stdout: { write: vi.fn() },
    };

    const exitCode = await installHooksCommand({}, deps);
    expect(exitCode).toBe(1);
  });
});

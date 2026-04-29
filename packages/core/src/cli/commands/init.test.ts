import { describe, expect, it, vi } from 'vitest';
import { InMemoryFileSystem, SilentLogger, FixedClock, InMemoryGitProvider } from '@sentiness/_test-utils';
import { initCommand } from './init.js';
import type { CommandDeps, ParsedArgs } from './types.js';

// Mock the Prompter class to run automatically
const mockConfirm = vi.fn().mockResolvedValue(true);
vi.mock('../wizard/prompts.js', () => {
  return {
    Prompter: class {
      confirm = mockConfirm;
      close = vi.fn();
    }
  };
});

describe('initCommand', () => {
  it('initializes a new project successfully', async () => {
    const fs = new InMemoryFileSystem({
      '/project/package.json': JSON.stringify({
        devDependencies: { vitest: '^1.0.0', typescript: '^5.0.0' }
      })
    });
    const logger = new SilentLogger();
    const deps: CommandDeps = {
      cwd: '/project',
      fs,
      logger,
      clock: new FixedClock(0),
      git: new InMemoryGitProvider(),
      processRunner: {} as any,
      stdout: { write: vi.fn() }
    };
    
    const args: ParsedArgs = {};
    mockConfirm.mockResolvedValue(true);

    const exitCode = await initCommand(args, deps);
    expect(exitCode).toBe(0);

    const configExists = await fs.exists('/project/sentiness.config.json');
    expect(configExists).toBe(true);

    const gitignore = await fs.readFile('/project/.gitignore');
    expect(gitignore).toContain('.sentiness/jobs/');
  });

  it('aborts if config exists and user says no', async () => {
    const fs = new InMemoryFileSystem({
      '/project/sentiness.config.json': '{}'
    });
    const logger = new SilentLogger();
    const deps: CommandDeps = {
      cwd: '/project',
      fs,
      logger,
      clock: new FixedClock(0),
      git: new InMemoryGitProvider(),
      processRunner: {} as any,
      stdout: { write: vi.fn() }
    };
    
    mockConfirm.mockResolvedValueOnce(false); // Do you want to overwrite? -> false

    const exitCode = await initCommand({}, deps);
    expect(exitCode).toBe(0);

    // It should not have created .gitignore since we aborted
    expect(await fs.exists('/project/.gitignore')).toBe(false);
  });
});

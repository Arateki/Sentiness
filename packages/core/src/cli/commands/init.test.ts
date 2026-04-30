import {
  FixedClock,
  InMemoryFileSystem,
  InMemoryGitProvider,
  SilentLogger,
} from '@sentiness/_test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initCommand } from './init.js';
import type { CommandDeps, ParsedArgs } from './types.js';

// Mock the Prompter class to run automatically
const mockConfirm = vi.fn().mockResolvedValue(true);
const mockAsk = vi.fn().mockResolvedValue('reports/mutation/mutation.json');
vi.mock('../wizard/prompts.js', () => {
  return {
    Prompter: class {
      ask = mockAsk;
      confirm = mockConfirm;
      close = vi.fn();
    },
  };
});

describe('initCommand', () => {
  beforeEach(() => {
    mockAsk.mockResolvedValue('reports/mutation/mutation.json');
    mockConfirm.mockResolvedValue(true);
  });

  it('initializes a new project successfully', async () => {
    const fs = new InMemoryFileSystem({
      '/project/package.json': JSON.stringify({
        devDependencies: { vitest: '^1.0.0', typescript: '^5.0.0' },
      }),
    });
    const logger = new SilentLogger();
    const deps: CommandDeps = {
      cwd: '/project',
      fs,
      logger,
      clock: new FixedClock(0),
      git: new InMemoryGitProvider(),
      processRunner: {} as unknown as import('@sentiness/check-sdk').ProcessRunner,
      stdout: { write: vi.fn() },
    };

    const args: ParsedArgs = {};
    const exitCode = await initCommand(args, deps);
    expect(exitCode).toBe(0);

    const configExists = await fs.exists('/project/sentiness.config.json');
    expect(configExists).toBe(true);
    const config = JSON.parse(await fs.readFile('/project/sentiness.config.json'));
    expect(Object.keys(config.checks)).toEqual([
      'biome',
      'knip',
      'coverage',
      'stryker',
      'deps-diff',
      'dependency-cruiser',
      'lockfile-lint',
      'jscpd',
      'osv-scanner',
      'semgrep',
    ]);

    const gitignore = await fs.readFile('/project/.gitignore');
    expect(gitignore).toContain('.sentiness/jobs/');
  });

  it('aborts if config exists and user says no', async () => {
    const fs = new InMemoryFileSystem({
      '/project/sentiness.config.json': '{}',
    });
    const logger = new SilentLogger();
    const deps: CommandDeps = {
      cwd: '/project',
      fs,
      logger,
      clock: new FixedClock(0),
      git: new InMemoryGitProvider(),
      processRunner: {} as unknown as import('@sentiness/check-sdk').ProcessRunner,
      stdout: { write: vi.fn() },
    };

    mockConfirm.mockResolvedValueOnce(false); // Do you want to overwrite? -> false

    const exitCode = await initCommand({}, deps);
    expect(exitCode).toBe(0);

    // It should not have created .gitignore since we aborted
    expect(await fs.exists('/project/.gitignore')).toBe(false);
  });

  it('does not duplicate Sentiness ignores covered by an existing .sentiness/ rule', async () => {
    const fs = new InMemoryFileSystem({
      '/project/package.json': JSON.stringify({}),
      '/project/.gitignore': 'node_modules/\n.sentiness/\n',
    });
    const logger = new SilentLogger();
    const deps: CommandDeps = {
      cwd: '/project',
      fs,
      logger,
      clock: new FixedClock(0),
      git: new InMemoryGitProvider(),
      processRunner: {} as unknown as import('@sentiness/check-sdk').ProcessRunner,
      stdout: { write: vi.fn() },
    };

    mockConfirm.mockResolvedValue(false);

    const exitCode = await initCommand({}, deps);

    expect(exitCode).toBe(0);
    expect(await fs.readFile('/project/.gitignore')).toBe('node_modules/\n.sentiness/\n');
  });

  it('prompts for Stryker reportPath when only JavaScript Stryker config exists', async () => {
    const fs = new InMemoryFileSystem({
      '/project/package.json': JSON.stringify({}),
      '/project/stryker.conf.mjs': 'export default {};',
    });
    const logger = new SilentLogger();
    const deps: CommandDeps = {
      cwd: '/project',
      fs,
      logger,
      clock: new FixedClock(0),
      git: new InMemoryGitProvider(),
      processRunner: {} as unknown as import('@sentiness/check-sdk').ProcessRunner,
      stdout: { write: vi.fn() },
    };
    mockAsk.mockResolvedValue('custom/mutation.json');

    const exitCode = await initCommand({ baseline: false }, deps);

    expect(exitCode).toBe(0);
    expect(mockAsk).toHaveBeenCalledWith(
      'Stryker JSON report path',
      'reports/mutation/mutation.json',
    );
    const config = JSON.parse(await fs.readFile('/project/sentiness.config.json'));
    expect(config.checks.stryker.reportPath).toBe('custom/mutation.json');
  });
});

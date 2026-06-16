import {
  FakeProcessRunner,
  FixedClock,
  InMemoryFileSystem,
  InMemoryGitProvider,
  SilentLogger,
} from '@sentiness/_test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initCommand } from './init.js';
import type { CommandDeps } from './types.js';

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

type TestDeps = CommandDeps & { readonly processRunner: FakeProcessRunner };

function makeDeps(fs: InMemoryFileSystem): TestDeps {
  return {
    cwd: '/project',
    cacheRoot: '/home/u/.sentiness',
    fs,
    logger: new SilentLogger(),
    clock: new FixedClock(0),
    git: new InMemoryGitProvider(),
    processRunner: new FakeProcessRunner(),
    stdout: { write: vi.fn() },
  };
}

// `init` resolves checks by running `sentiness install`, which begins by asking
// the registry for the engine version. Detect that call to assert install ran.
function ranInstall(deps: TestDeps): boolean {
  return deps.processRunner.calls.some(
    (call) =>
      call.command === 'npm' &&
      call.args[0] === 'view' &&
      typeof call.args[1] === 'string' &&
      call.args[1].startsWith('@sentiness/core'),
  );
}

function pnpmProject(extraFiles: Record<string, string> = {}): InMemoryFileSystem {
  return new InMemoryFileSystem({
    '/project/package.json': JSON.stringify({
      devDependencies: { vitest: '^1.0.0', typescript: '^5.0.0' },
    }),
    '/project/pnpm-lock.yaml': "lockfileVersion: '9.0'\n",
    ...extraFiles,
  });
}

describe('initCommand', () => {
  beforeEach(() => {
    mockAsk.mockResolvedValue('reports/mutation/mutation.json');
    mockConfirm.mockReset();
    mockConfirm.mockResolvedValue(true);
  });

  it('initializes a new project successfully', async () => {
    const fs = pnpmProject();
    const deps = makeDeps(fs);

    const exitCode = await initCommand({}, deps);
    expect(exitCode).toBe(0);

    const config = JSON.parse(await fs.readFile('/project/sentiness.config.json'));
    expect(config.schemaVersion).toBe('2.0');
    expect(typeof config.engine).toBe('string');
    expect(config.engine.length).toBeGreaterThan(0);
    expect(Object.keys(config.checks)).toEqual([
      'biome',
      'eslint',
      'knip',
      'coverage',
      'stryker',
      'deps-diff',
      'dependency-cruiser',
      'lockfile-lint',
      'jscpd',
      'osv-scanner',
      'semgrep',
      'playwright',
    ]);
    // Each catalog entry declares exactly one of version/path (v2 contract).
    expect(config.checks.biome.version).toBe('*');
    expect(config.checks.biome.path).toBeUndefined();

    const gitignore = await fs.readFile('/project/.gitignore');
    expect(gitignore).toContain('.sentiness/jobs/');
  });

  it('runs `sentiness install` to resolve checks on consent, never `<pm> add -D`', async () => {
    const fs = pnpmProject();
    const deps = makeDeps(fs);
    mockConfirm.mockImplementation(async (question: string) => {
      if (question.startsWith('Enable')) {
        return question.startsWith('Enable Biome check');
      }
      return question.startsWith('Resolve');
    });

    const exitCode = await initCommand({}, deps);

    expect(exitCode).toBe(0);
    expect(ranInstall(deps)).toBe(true);
    expect(deps.processRunner.calls.filter((call) => call.args[0] === 'add')).toHaveLength(0);
  });

  it('skips check resolution when the user refuses', async () => {
    const fs = pnpmProject();
    const deps = makeDeps(fs);
    mockConfirm.mockImplementation(async (question: string) => {
      if (question.startsWith('Enable')) {
        return question.startsWith('Enable Biome check');
      }
      return false;
    });

    const exitCode = await initCommand({}, deps);

    expect(exitCode).toBe(0);
    expect(ranInstall(deps)).toBe(false);
  });

  it('warns and continues when check resolution fails', async () => {
    const fs = pnpmProject();
    const deps = makeDeps(fs);
    // With no scripted npm output, `npm view` yields empty stdout, so install
    // throws while parsing it; init must warn and still leave a config behind.
    mockConfirm.mockImplementation(async (question: string) => {
      if (question.startsWith('Enable')) {
        return question.startsWith('Enable Biome check');
      }
      return question.startsWith('Resolve');
    });

    const exitCode = await initCommand({}, deps);

    expect(exitCode).toBe(0);
    expect(await fs.exists('/project/sentiness.config.json')).toBe(true);
  });

  it('does not resolve checks in --yes mode without --install', async () => {
    const fs = pnpmProject();
    const deps = makeDeps(fs);

    const exitCode = await initCommand({ yes: true, checks: 'biome', baseline: false }, deps);

    expect(exitCode).toBe(0);
    expect(ranInstall(deps)).toBe(false);
    expect(await fs.exists('/project/.claude/skills/sentiness/SKILL.md')).toBe(false);
    expect(await fs.exists('/project/.git/hooks/pre-commit')).toBe(false);
  });

  it('resolves checks in --yes mode with --install', async () => {
    const fs = pnpmProject();
    const deps = makeDeps(fs);

    const exitCode = await initCommand(
      { yes: true, checks: 'biome', baseline: false, install: true },
      deps,
    );

    expect(exitCode).toBe(0);
    expect(ranInstall(deps)).toBe(true);
    expect(deps.processRunner.calls.filter((call) => call.args[0] === 'add')).toHaveLength(0);
  });

  it('formats the generated config with the project formatter (biome)', async () => {
    const fs = pnpmProject();
    const deps = makeDeps(fs);

    const exitCode = await initCommand({ yes: true, checks: 'biome', baseline: false }, deps);

    expect(exitCode).toBe(0);
    expect(deps.processRunner.calls).toContainEqual({
      command: 'biome',
      args: ['format', '--write', '/project/sentiness.config.json'],
      options: { cwd: '/project' },
    });
  });

  it('continues when biome is unavailable to format the generated config', async () => {
    const fs = pnpmProject();
    const deps = makeDeps(fs);
    deps.processRunner.enqueue({ stdout: '', stderr: 'biome: command not found', exitCode: 1 });

    const exitCode = await initCommand({ yes: true, checks: 'biome', baseline: false }, deps);

    expect(exitCode).toBe(0);
    expect(deps.processRunner.calls.some((call) => call.command === 'biome')).toBe(true);
    expect(await fs.exists('/project/sentiness.config.json')).toBe(true);
  });

  it('installs agent instructions for --skill agents and records them in config', async () => {
    const fs = pnpmProject();
    const deps = makeDeps(fs);

    const exitCode = await initCommand(
      { yes: true, checks: 'biome', baseline: false, skill: 'claude-code-skill' },
      deps,
    );

    expect(exitCode).toBe(0);
    expect(await fs.exists('/project/.claude/skills/sentiness/SKILL.md')).toBe(true);
    const config = JSON.parse(await fs.readFile('/project/sentiness.config.json'));
    expect(config.agents).toEqual(['claude-code-skill']);
  });

  it('offers detected agents in interactive mode', async () => {
    const fs = pnpmProject({ '/project/AGENTS.md': '# existing instructions' });
    const deps = makeDeps(fs);
    mockConfirm.mockImplementation(async (question: string) => {
      if (question.startsWith('Enable')) {
        return false;
      }
      if (question.startsWith('Create')) {
        return false;
      }
      return true;
    });

    const exitCode = await initCommand({}, deps);

    expect(exitCode).toBe(0);
    expect(
      mockConfirm.mock.calls.some(
        (call) => typeof call[0] === 'string' && call[0].includes('codex-skill'),
      ),
    ).toBe(true);
    const skill = await fs.readFile('/project/.agents/skills/sentiness/SKILL.md');
    expect(skill).toContain('name: sentiness');
    expect(await fs.readFile('/project/AGENTS.md')).toBe('# existing instructions');
  });

  it('installs git hooks with --hooks', async () => {
    const fs = pnpmProject();
    const deps = makeDeps(fs);

    const exitCode = await initCommand(
      { yes: true, checks: 'biome', baseline: false, hooks: true },
      deps,
    );

    expect(exitCode).toBe(0);
    expect(await fs.exists('/project/.git/hooks/pre-commit')).toBe(true);
    expect(await fs.exists('/project/.git/hooks/pre-push')).toBe(true);
  });

  it('aborts if config exists and user says no', async () => {
    const fs = new InMemoryFileSystem({
      '/project/sentiness.config.json': '{}',
    });
    const deps = makeDeps(fs);

    mockConfirm.mockResolvedValueOnce(false); // Do you want to overwrite? -> false

    const exitCode = await initCommand({}, deps);
    expect(exitCode).toBe(0);
    expect(await fs.exists('/project/.gitignore')).toBe(false);
  });

  it('does not duplicate Sentiness ignores covered by an existing .sentiness/ rule', async () => {
    const fs = new InMemoryFileSystem({
      '/project/package.json': JSON.stringify({}),
      '/project/.gitignore': 'node_modules/\n.sentiness/\n',
    });
    const deps = makeDeps(fs);

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
    const deps = makeDeps(fs);
    mockAsk.mockResolvedValue('custom/mutation.json');
    mockConfirm.mockImplementation(async (question: string) => question.startsWith('Enable'));

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

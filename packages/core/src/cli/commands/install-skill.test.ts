import {
  FixedClock,
  InMemoryFileSystem,
  InMemoryGitProvider,
  SilentLogger,
} from '@sentiness/_test-utils';
import type { AgentAdapter, RenderOptions } from '@sentiness/adapters';
import type { ProcessRunner } from '@sentiness/check-sdk';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../../config/config.js';
import { SENTINESS_VERSION } from '../../version.js';
import { installSkillCommand } from './install-skill.js';
import type { CommandDeps } from './types.js';

function fakeAdapter(
  agent: AgentAdapter['agent'],
  targetFile: AgentAdapter['targetFile'],
): AgentAdapter {
  return {
    agent,
    targetFile,
    async install(cwd: string, fs, options: RenderOptions) {
      const targetPath = `${cwd}/${targetFile}`;
      await fs.writeFile(targetPath, `${agent}:${options.sentinessVersion}:${options.configPath}`);
      return { agent, targetPath, changed: true };
    },
  };
}

function depsFor(fs: InMemoryFileSystem): CommandDeps {
  const processRunner: ProcessRunner = {
    execFile: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
  };
  const adapters = [
    fakeAdapter('claude-code', 'CLAUDE.md'),
    fakeAdapter('claude-code-skill', '.claude/skills/sentiness/SKILL.md'),
    fakeAdapter('codex', 'AGENTS.md'),
    fakeAdapter('gemini', 'GEMINI.md'),
  ] as const;

  return {
    cwd: '/project',
    fs,
    logger: new SilentLogger(),
    clock: new FixedClock(0),
    git: new InMemoryGitProvider(),
    processRunner,
    stdout: { write: vi.fn() },
    adapterLoader: async () => ({
      listAdapters: () => adapters,
      getAdapter: (agent) => adapters.find((adapter) => adapter.agent === agent),
    }),
  };
}

describe('installSkillCommand', () => {
  it('installs a single requested adapter', async () => {
    const fs = new InMemoryFileSystem({
      '/project/sentiness.config.json': JSON.stringify(DEFAULT_CONFIG),
    });
    const deps = depsFor(fs);

    const exitCode = await installSkillCommand({ agent: 'codex' }, deps);

    expect(exitCode).toBe(0);
    expect(await fs.readFile('/project/AGENTS.md')).toContain(
      `codex:${SENTINESS_VERSION}:sentiness.config.json`,
    );
    expect(deps.stdout.write).toHaveBeenCalledWith(
      `${JSON.stringify(
        {
          results: [{ agent: 'codex', targetPath: '/project/AGENTS.md', changed: true }],
        },
        null,
        2,
      )}\n`,
    );
  });

  it('installs all adapters', async () => {
    const fs = new InMemoryFileSystem({
      '/project/sentiness.config.json': JSON.stringify(DEFAULT_CONFIG),
    });

    const exitCode = await installSkillCommand({ agent: 'all' }, depsFor(fs));

    expect(exitCode).toBe(0);
    expect(await fs.exists('/project/CLAUDE.md')).toBe(true);
    expect(await fs.exists('/project/.claude/skills/sentiness/SKILL.md')).toBe(true);
    expect(await fs.exists('/project/AGENTS.md')).toBe(true);
    expect(await fs.exists('/project/GEMINI.md')).toBe(true);
  });

  it('accepts agents: ["claude-code-skill"] in config and installs only the skill', async () => {
    const fs = new InMemoryFileSystem({
      '/project/sentiness.config.json': JSON.stringify({
        ...DEFAULT_CONFIG,
        agents: ['claude-code-skill'],
      }),
    });

    const exitCode = await installSkillCommand({ agent: 'all' }, depsFor(fs));

    expect(exitCode).toBe(0);
    expect(await fs.exists('/project/.claude/skills/sentiness/SKILL.md')).toBe(true);
    expect(await fs.exists('/project/CLAUDE.md')).toBe(false);
    expect(await fs.exists('/project/AGENTS.md')).toBe(false);
    expect(await fs.exists('/project/GEMINI.md')).toBe(false);
  });

  it('filters --agent=all through config.agents when configured', async () => {
    const fs = new InMemoryFileSystem({
      '/project/sentiness.config.json': JSON.stringify({
        ...DEFAULT_CONFIG,
        agents: ['codex'],
      }),
    });

    const exitCode = await installSkillCommand({ agent: 'all' }, depsFor(fs));

    expect(exitCode).toBe(0);
    expect(await fs.exists('/project/CLAUDE.md')).toBe(false);
    expect(await fs.exists('/project/AGENTS.md')).toBe(true);
    expect(await fs.exists('/project/GEMINI.md')).toBe(false);
  });

  it('rejects missing or invalid agents', async () => {
    const fs = new InMemoryFileSystem({
      '/project/sentiness.config.json': JSON.stringify(DEFAULT_CONFIG),
    });

    expect(await installSkillCommand({}, depsFor(fs))).toBe(1);
    expect(await installSkillCommand({ agent: 'unknown' }, depsFor(fs))).toBe(1);
  });
});

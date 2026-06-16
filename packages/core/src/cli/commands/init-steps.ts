import type { Logger } from '@sentiness/check-sdk';
import { installCommand } from './install.js';
import { installHooksCommand } from './install-hooks.js';
import { installSkillCommand } from './install-skill.js';
import type { CommandDeps, ParsedArgs } from './types.js';

const KNOWN_AGENTS = [
  'claude-code',
  'claude-code-skill',
  'codex',
  'codex-skill',
  'gemini',
] as const;

export function parseAgentSelection(value: unknown, logger: Logger): readonly string[] {
  if (typeof value !== 'string' || value === 'none') {
    return [];
  }
  const selected: string[] = [];
  for (const agent of value.split(',')) {
    const name = agent.trim();
    if (name.length === 0) {
      continue;
    }
    if ((KNOWN_AGENTS as readonly string[]).includes(name)) {
      selected.push(name);
    } else {
      logger.warn(`Unknown agent "${name}" ignored. Known agents: ${KNOWN_AGENTS.join(', ')}`);
    }
  }
  return selected;
}

// v2 has no project node_modules: instead of `<pm> add -D`, init resolves the
// catalog's version ranges against the registry, writes `sentiness.lock`, and
// warms the global cache via `sentiness install`. A failure here is never fatal
// to init — the user can re-run `sentiness install` later.
export async function runCheckInstall(deps: CommandDeps): Promise<void> {
  try {
    const code = await installCommand({ frozen: false }, deps);
    if (code !== 0) {
      deps.logger.warn(
        'Check resolution did not complete; run `sentiness install` later to cache the checks.',
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.logger.warn(
      `Failed to resolve checks (${message}); run \`sentiness install\` later to cache them.`,
    );
  }
}

// JSON.stringify expands every array onto multiple lines, while Biome collapses
// short arrays inline, so a freshly generated config would immediately fail the
// project's own biome check. Delegate to the project formatter instead of
// imitating its style; when biome is absent or rejects the file this is a no-op.
export async function formatGeneratedConfig(configPath: string, deps: CommandDeps): Promise<void> {
  const result = await deps.processRunner.execFile('biome', ['format', '--write', configPath], {
    cwd: deps.cwd,
  });
  if (result.exitCode === 0) {
    deps.logger.info('Formatted sentiness.config.json with the project formatter (biome).');
  } else {
    deps.logger.debug('Skipped formatting the generated config; biome unavailable or declined.', {
      exitCode: result.exitCode,
      stderr: result.stderr,
    });
  }
}

export async function installAgentSkills(
  agents: readonly string[],
  deps: CommandDeps,
): Promise<void> {
  for (const agent of agents) {
    const exitCode = await installSkillCommand({ agent }, deps);
    if (exitCode !== 0) {
      deps.logger.warn(
        `Failed to install agent instructions for ${agent}; run \`sentiness install-skill --agent=${agent}\` later.`,
      );
    }
  }
}

export async function installGitHooks(args: ParsedArgs, deps: CommandDeps): Promise<void> {
  const exitCode = await installHooksCommand({ ...args, push: true }, deps);
  if (exitCode !== 0) {
    deps.logger.warn('Hook installation failed; run `sentiness install-hooks` later.');
  }
}

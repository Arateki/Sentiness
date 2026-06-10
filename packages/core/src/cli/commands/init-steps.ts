import type { Logger } from '@sentiness/check-sdk';
import { missingPackagesFor, type OnboardingPlan } from './init-plan.js';
import { installHooksCommand } from './install-hooks.js';
import { installSkillCommand } from './install-skill.js';
import type { CommandDeps, ParsedArgs } from './types.js';

const KNOWN_AGENTS = ['claude-code', 'claude-code-skill', 'codex', 'gemini'] as const;

const NON_NPM_TOOL_HINTS: Readonly<Record<string, string>> = {
  'osv-scanner':
    'osv-scanner is not an npm package; install it from https://google.github.io/osv-scanner/installation/',
  semgrep:
    'semgrep is not an npm package; install it from https://semgrep.dev/docs/getting-started/cli/',
};

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

export async function installMissingPackages(
  plan: OnboardingPlan,
  enabledCheckIds: readonly string[],
  shouldInstall: (command: string) => Promise<boolean>,
  deps: CommandDeps,
): Promise<void> {
  for (const id of enabledCheckIds) {
    const hint = NON_NPM_TOOL_HINTS[id];
    if (hint) {
      deps.logger.info(hint);
    }
  }

  const missing = missingPackagesFor(enabledCheckIds, plan.installedDependencies);
  if (missing.length === 0) {
    return;
  }
  const command = `${plan.packageManager} add -D ${missing.join(' ')}`;
  if (plan.packageManager === 'unknown') {
    deps.logger.warn(
      `Package manager not detected; install the missing packages manually: <pm> add -D ${missing.join(' ')}`,
    );
    return;
  }
  if (!(await shouldInstall(command))) {
    deps.logger.info(`Skipped package installation. Install manually with: ${command}`);
    return;
  }
  deps.logger.info(`Running: ${command}`);
  const result = await deps.processRunner.execFile(plan.packageManager, ['add', '-D', ...missing], {
    cwd: deps.cwd,
  });
  if (result.exitCode !== 0) {
    deps.logger.warn(
      `Package installation failed (exit ${result.exitCode}); continuing. Install manually with: ${command}`,
    );
  } else {
    deps.logger.info(`Installed ${missing.length} package(s).`);
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

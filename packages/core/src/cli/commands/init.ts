import { isAbsolute, join } from 'node:path';
import { Prompter } from '../wizard/prompts.js';
import { baselineInitCommand } from './baseline.js';
import { buildOnboardingPlan } from './init-plan.js';
import {
  formatGeneratedConfig,
  installAgentSkills,
  installGitHooks,
  installMissingPackages,
  parseAgentSelection,
} from './init-steps.js';
import type { CommandDeps, ParsedArgs } from './types.js';

function resolvePath(cwd: string, path: string): string {
  return isAbsolute(path) ? path : join(cwd, path);
}

const sentinessIgnoreEntries = [
  '.sentiness/jobs/',
  '.sentiness/cache/',
  '.sentiness/pending-feedback.json',
  '.sentiness/pending-feedback.json.lock/',
] as const;

const strykerJsConfigCandidates = [
  'stryker.conf.js',
  'stryker.conf.mjs',
  'stryker.conf.cjs',
  'stryker.config.js',
  'stryker.config.mjs',
  'stryker.config.cjs',
] as const;
const strykerJsonConfigCandidates = ['stryker.conf.json', 'stryker.config.json'] as const;

function existingIgnoreLines(content: string): ReadonlySet<string> {
  return new Set(
    content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#')),
  );
}

function missingSentinessIgnoreEntries(content: string): readonly string[] {
  const lines = existingIgnoreLines(content);
  if (lines.has('.sentiness/') || lines.has('.sentiness')) {
    return [];
  }
  return sentinessIgnoreEntries.filter((entry) => !lines.has(entry));
}

function ignoreBlock(entries: readonly string[]): string {
  return `# Sentiness\n${entries.join('\n')}\n`;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function enabledCheckSet(args: ParsedArgs): ReadonlySet<string> | undefined {
  const checks = optionalString(args.checks);
  if (!checks) {
    return undefined;
  }
  return new Set(
    checks
      .split(',')
      .map((check) => check.trim())
      .filter((check) => check.length > 0),
  );
}

async function hasAnyFile(
  cwd: string,
  fs: CommandDeps['fs'],
  candidates: readonly string[],
): Promise<boolean> {
  for (const candidate of candidates) {
    if (await fs.exists(resolvePath(cwd, candidate))) {
      return true;
    }
  }
  return false;
}

async function shouldPromptForStrykerReportPath(
  cwd: string,
  fs: CommandDeps['fs'],
): Promise<boolean> {
  const hasJsConfig = await hasAnyFile(cwd, fs, strykerJsConfigCandidates);
  const hasJsonConfig = await hasAnyFile(cwd, fs, strykerJsonConfigCandidates);
  return hasJsConfig && !hasJsonConfig;
}

export async function initCommand(args: ParsedArgs, deps: CommandDeps): Promise<number> {
  const isNonInteractive = args.yes === true;
  const selectedChecks = enabledCheckSet(args);
  const prompter = isNonInteractive ? undefined : new Prompter(deps.stdout);

  const confirm = async (
    question: string,
    defaultValue: boolean,
    nonInteractiveValue = defaultValue,
  ): Promise<boolean> =>
    prompter ? prompter.confirm(question, defaultValue) : nonInteractiveValue;

  try {
    deps.logger.info('Welcome to Sentiness Init Wizard!');

    const configPath = resolvePath(deps.cwd, 'sentiness.config.json');
    if (await deps.fs.exists(configPath)) {
      const proceed = await confirm(
        'sentiness.config.json already exists. Do you want to overwrite it?',
        false,
        true,
      );
      if (!proceed) {
        deps.logger.info('Init aborted.');
        return 0;
      }
    }

    const plan = await buildOnboardingPlan(deps.cwd, deps.fs);
    deps.logger.info(`Detected Package Manager: ${plan.packageManager}`);
    deps.logger.info(`Detected TypeScript: ${plan.hasTypescript ? 'yes' : 'no'}`);
    deps.logger.info(`Detected Test Runner: ${plan.testRunner}`);
    if (plan.detectedAgents.length > 0) {
      deps.logger.info(`Detected AI agents: ${plan.detectedAgents.join(', ')}`);
    }

    const checks: Record<string, unknown> = {};
    for (const check of plan.checks) {
      const enabled = await confirm(
        `Enable ${check.label}?`,
        check.recommended,
        selectedChecks ? selectedChecks.has(check.id) : check.recommended,
      );
      if (!enabled) {
        continue;
      }
      const checkConfig: Record<string, unknown> = { enabled: true, tier: check.tier };
      if (check.id === 'stryker' && prompter) {
        if (await shouldPromptForStrykerReportPath(deps.cwd, deps.fs)) {
          const reportPath = await prompter.ask(
            'Stryker JSON report path',
            'reports/mutation/mutation.json',
          );
          if (reportPath.trim().length > 0) {
            checkConfig.reportPath = reportPath.trim();
          }
        }
      }
      checks[check.id] = checkConfig;
    }

    let agents: readonly string[];
    if (isNonInteractive || args.skill !== undefined) {
      agents = parseAgentSelection(args.skill, deps.logger);
    } else {
      const candidates =
        plan.detectedAgents.length > 0 ? plan.detectedAgents : ['claude-code-skill'];
      const wanted = await confirm(
        `Install AI agent instructions for: ${candidates.join(', ')}?`,
        true,
      );
      agents = wanted ? candidates : [];
    }

    const config = {
      schemaVersion: '1.0',
      tiers: {
        fast: { triggers: ['post-edit', 'pre-commit'], timeoutMs: 30000 },
        standard: { triggers: ['pre-done'], timeoutMs: 120000 },
        slow: { triggers: ['pre-push', 'pre-pr', 'manual'], timeoutMs: 600000 },
      },
      checks,
      baseline: { path: '.sentiness/baseline.json' },
      pending: { path: '.sentiness/pending-feedback.json' },
      reporting: { compact: false, omitOk: true, warningsAreErrors: false },
      ...(agents.length > 0 ? { agents } : {}),
    };

    await deps.fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
    deps.logger.info(`Created ${configPath}`);

    const sentinessDir = resolvePath(deps.cwd, '.sentiness');
    await deps.fs.mkdir(join(sentinessDir, 'jobs'), { recursive: true });
    await deps.fs.mkdir(join(sentinessDir, 'cache'), { recursive: true });

    const gitignorePath = resolvePath(deps.cwd, '.gitignore');
    if (await deps.fs.exists(gitignorePath)) {
      const current = await deps.fs.readFile(gitignorePath);
      const missingEntries = missingSentinessIgnoreEntries(current);
      if (missingEntries.length > 0) {
        const separator = current.endsWith('\n') ? '\n' : '\n\n';
        await deps.fs.appendFile(gitignorePath, `${separator}${ignoreBlock(missingEntries)}`);
        deps.logger.info('Added .sentiness/ ignores to .gitignore');
      }
    } else {
      await deps.fs.writeFile(gitignorePath, ignoreBlock(sentinessIgnoreEntries));
      deps.logger.info('Created .gitignore with .sentiness/ ignores');
    }

    await installMissingPackages(
      plan,
      Object.keys(checks),
      async (command) =>
        confirm(`Install missing packages? (${command})`, true, args.install === true),
      deps,
    );

    await formatGeneratedConfig(configPath, deps);

    await installAgentSkills(agents, deps);

    const wantHooks =
      isNonInteractive || args.hooks !== undefined
        ? args.hooks === true
        : (await deps.git.isRepo(deps.cwd)) &&
          (await confirm(
            'Install git hooks? (pre-commit fast checks, pre-push slow checks)',
            true,
          ));
    if (wantHooks) {
      await installGitHooks(args, deps);
    }

    const runBaseline = await confirm(
      '\nCreate initial baseline now? (recommended for existing projects)',
      true,
      args.baseline !== false,
    );
    if (runBaseline) {
      deps.logger.info('Running baseline init...');
      await baselineInitCommand(args, deps);
    }

    deps.logger.info('\nSentiness initialization complete!');
  } finally {
    prompter?.close();
  }

  return 0;
}

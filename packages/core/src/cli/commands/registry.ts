import type { CAC } from 'cac';
import {
  baselineAcceptCommand,
  baselineInitCommand,
  baselinePruneCommand,
  baselineUpdateCommand,
} from './baseline.js';
import { checkCommand } from './check.js';
import { doctorCommand } from './doctor.js';
import { initCommand } from './init.js';
import { installHooksCommand } from './install-hooks.js';
import { installSkillCommand } from './install-skill.js';
import { pendingCommand } from './pending.js';
import { statusCommand } from './status.js';
import type { CommandDeps, ParsedArgs } from './types.js';

type CommandHandler = (args: ParsedArgs, deps: CommandDeps) => Promise<number>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function runHandler(
  handler: CommandHandler,
  args: ParsedArgs,
  deps: CommandDeps,
): Promise<void> {
  try {
    const exitCode = await handler(args, deps);
    process.exitCode = exitCode;
  } catch (error) {
    deps.logger.error(error instanceof Error ? error.message : 'Unknown CLI error');
    process.exitCode = 3;
  }
}

function wrap(handler: CommandHandler, deps: CommandDeps): (args: ParsedArgs) => Promise<void> {
  return async (args) => runHandler(handler, args, deps);
}

function positionalArgs(values: readonly unknown[]): readonly string[] {
  return values.flatMap((value) => {
    if (Array.isArray(value)) {
      return value.filter((item): item is string => typeof item === 'string');
    }
    return typeof value === 'string' ? [value] : [];
  });
}

function wrapWithPositionals(
  handler: CommandHandler,
  deps: CommandDeps,
): (...values: unknown[]) => Promise<void> {
  return async (...values) => {
    const maybeOptions = values.at(-1);
    const optionEntries = isRecord(maybeOptions) ? Object.entries(maybeOptions) : [];
    const options = Object.fromEntries(optionEntries);
    const args: ParsedArgs = {
      ...options,
      _: positionalArgs(values.slice(0, -1)),
    };
    await runHandler(handler, args, deps);
  };
}

export function registerCommands(cli: CAC, deps: CommandDeps): void {
  cli
    .command('init', 'Initialize Sentiness in the current repository')
    .option('--yes', 'Run non-interactively with default answers')
    .option('--checks <ids>', 'Comma-separated check ids to enable in non-interactive mode')
    .option('--no-baseline', 'Skip initial baseline creation')
    .action(wrap(initCommand, deps));

  cli
    .command('install-hooks', 'Install Git hooks (pre-commit, optional pre-push)')
    .option('--push', 'Also install pre-push hook')
    .action(wrap(installHooksCommand, deps));

  cli
    .command('install-skill', 'Install managed Sentiness instructions for an AI agent')
    .option('--agent <agent>', 'claude-code, codex, gemini, or all')
    .action(wrap(installSkillCommand, deps));

  cli
    .command('check', 'Run configured quality checks')
    .option('--tier <tier>', 'fast, standard, or slow')
    .option('--trigger <trigger>', 'Resolve tier from trigger')
    .option('--diff', 'Only keep findings introduced in changed files')
    .option('--trend', 'Track metric regressions across the whole codebase')
    .option('--base <ref>', 'Base ref for diff mode')
    .option('--background', 'Run check in a background job')
    .option('--job-id <id>', 'Internal: set job id for the run')
    .option('--compact', 'Omit ok checks from report')
    .option('--output <path>', 'Also write report JSON to a file')
    .action(wrap(checkCommand, deps));

  cli.command('doctor', 'Diagnose configured checks').action(wrap(doctorCommand, deps));

  cli
    .command('status [jobId]', 'Check status of a background job')
    .action(wrapWithPositionals(statusCommand, deps));

  cli
    .command(
      'pending [...args]',
      'List or acknowledge pending feedback (usage: sentiness pending [ack <id>])',
    )
    .option('--all', 'Show all pending items including acknowledged ones')
    .action(wrapWithPositionals(pendingCommand, deps));

  const baselineCmd = cli.command(
    'baseline <action>',
    'Manage the baseline file (init, update, accept, prune)',
  );

  baselineCmd.action(async (action, args) => {
    switch (action) {
      case 'init':
        await wrap(baselineInitCommand, deps)(args);
        break;
      case 'update':
        await wrap(baselineUpdateCommand, deps)(args);
        break;
      case 'accept':
        await wrap(baselineAcceptCommand, deps)(args);
        break;
      case 'prune':
        await wrap(baselinePruneCommand, deps)(args);
        break;
      default:
        deps.logger.error(`Unknown baseline action: ${action}`);
        process.exitCode = 1;
    }
  });

  baselineCmd
    .option('--metric <name>', 'Only update the specified metric (update action)')
    .option('--fingerprint <sha256>', 'The finding fingerprint to accept (accept action)')
    .option('--reason <text>', 'Reason for accepting the finding (accept action)');
}

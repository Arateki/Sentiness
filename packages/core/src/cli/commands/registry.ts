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
import { pendingCommand } from './pending.js';
import { statusCommand } from './status.js';
import type { CommandDeps, ParsedArgs } from './types.js';

type CommandHandler = (args: ParsedArgs, deps: CommandDeps) => Promise<number>;

function wrap(handler: CommandHandler, deps: CommandDeps): (args: ParsedArgs) => Promise<void> {
  return async (args) => {
    try {
      const exitCode = await handler(args, deps);
      process.exitCode = exitCode;
    } catch (error) {
      deps.logger.error(error instanceof Error ? error.message : 'Unknown CLI error');
      process.exitCode = 3;
    }
  };
}

export function registerCommands(cli: CAC, deps: CommandDeps): void {
  cli
    .command('init', 'Initialize Sentiness in the current repository')
    .action(wrap(initCommand, deps));

  cli
    .command('install-hooks', 'Install Git hooks (pre-commit, optional pre-push)')
    .option('--push', 'Also install pre-push hook')
    .action(wrap(installHooksCommand, deps));

  cli
    .command('check', 'Run configured quality checks')
    .option('--tier <tier>', 'fast, standard, or slow')
    .option('--trigger <trigger>', 'Resolve tier from trigger')
    .option('--diff', 'Only keep findings introduced in changed files')
    .option('--base <ref>', 'Base ref for diff mode')
    .option('--background', 'Run check in a background job')
    .option('--job-id <id>', 'Internal: set job id for the run')
    .option('--compact', 'Omit ok checks from report')
    .option('--output <path>', 'Also write report JSON to a file')
    .action(wrap(checkCommand, deps));

  cli.command('doctor', 'Diagnose configured checks').action(wrap(doctorCommand, deps));

  cli
    .command('status [jobId]', 'Check status of a background job')
    .action(wrap(statusCommand, deps));

  cli
    .command(
      'pending [...args]',
      'List or acknowledge pending feedback (usage: sentiness pending [ack <id>])',
    )
    .option('--all', 'Show all pending items including acknowledged ones')
    .action(wrap(pendingCommand, deps));

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

import type { CAC } from 'cac';
import { checkCommand } from './check.js';
import { doctorCommand } from './doctor.js';
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
    .command('check', 'Run configured quality checks')
    .option('--tier <tier>', 'fast, standard, or slow')
    .option('--trigger <trigger>', 'Resolve tier from trigger')
    .option('--diff', 'Only keep findings introduced in changed files')
    .option('--base <ref>', 'Base ref for diff mode')
    .option('--compact', 'Omit ok checks from report')
    .option('--output <path>', 'Also write report JSON to a file')
    .action(wrap(checkCommand, deps));

  cli.command('doctor', 'Diagnose configured checks').action(wrap(doctorCommand, deps));
}

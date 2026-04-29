import { isAbsolute, join } from 'node:path';
import { loadConfig } from '../../config/config.js';
import { PendingQueue } from '../../pending/pending.js';
import type { CommandDeps, ParsedArgs } from './types.js';

function resolvePath(cwd: string, path: string): string {
  return isAbsolute(path) ? path : join(cwd, path);
}

export async function pendingCommand(args: ParsedArgs, deps: CommandDeps): Promise<number> {
  const config = await loadConfig(deps.cwd, deps.fs);
  const pendingPath = resolvePath(deps.cwd, config.pending.path);
  const queue = new PendingQueue(pendingPath, deps.fs, deps.clock, deps.logger);

  // Command acts as 'pending' (list) or 'pending ack <id>' based on args._
  const positional = args._ ?? [];
  const action = positional[0];

  if (action === 'ack') {
    const id = positional[1];
    if (typeof id !== 'string') {
      deps.logger.error('Usage: sentiness pending ack <id>');
      return 1;
    }
    await queue.ack(id);
    deps.logger.info(`Pending feedback ${id} acknowledged.`);
    return 0;
  }

  if (action !== undefined) {
    deps.logger.error(`Unknown pending action: ${String(action)}`);
    return 1;
  }

  const showAll = args.all === true;
  const items = showAll ? await queue.load() : await queue.unacked();

  deps.stdout.write(`${JSON.stringify(items, null, 2)}\n`);
  return 0;
}

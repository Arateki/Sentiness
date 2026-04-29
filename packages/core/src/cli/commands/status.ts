import { isAbsolute, join } from 'node:path';
import { JobReader } from '../../jobs/status.js';
import type { CommandDeps, ParsedArgs } from './types.js';

function resolvePath(cwd: string, path: string): string {
  return isAbsolute(path) ? path : join(cwd, path);
}

export async function statusCommand(args: ParsedArgs, deps: CommandDeps): Promise<number> {
  const positional = args._ ?? [];
  const jobId = positional[0]; // first positional argument
  if (typeof jobId !== 'string') {
    deps.logger.error('Usage: sentiness status <jobId>');
    return 1;
  }

  const jobsDir = resolvePath(deps.cwd, '.sentiness/jobs');
  const reader = new JobReader(jobsDir, deps.fs, deps.logger);
  const meta = await reader.read(jobId);

  if (!meta) {
    deps.logger.error(`Job not found: ${jobId}`);
    return 1;
  }

  deps.stdout.write(`${JSON.stringify(meta, null, 2)}\n`);

  if (meta.status === 'completed' && meta.exitCode !== 0) {
    return meta.exitCode ?? 1;
  }

  return 0;
}

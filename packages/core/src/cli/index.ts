#!/usr/bin/env node
import { writeSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import type { Clock } from '@sentiness/check-sdk';
import { cac } from 'cac';
import { createNodeFileSystem } from '../fs/node-fs.js';
import { createGitProvider } from '../git/git.js';
import { createLogger } from '../logger/logger.js';
import { createProcessRunner } from '../process/process-runner.js';
import { SENTINESS_VERSION } from '../version.js';
import { registerCommands } from './commands/registry.js';

const systemClock: Clock = {
  now: () => Date.now(),
  isoNow: () => new Date().toISOString(),
};

// The launcher passes the resolved cache root as `--cache-root <value>`. Extract
// it before cac sees the argv (cac would otherwise treat it as a global option),
// defaulting to ~/.sentiness so the engine still runs when invoked directly.
function extractCacheRoot(argv: readonly string[]): { cacheRoot: string; rest: string[] } {
  const rest: string[] = [];
  let cacheRoot = join(homedir(), '.sentiness');
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--cache-root') {
      const value = argv[i + 1];
      if (value !== undefined) {
        cacheRoot = value;
        i += 1;
      }
      continue;
    }
    if (arg !== undefined && arg.startsWith('--cache-root=')) {
      cacheRoot = arg.slice('--cache-root='.length);
      continue;
    }
    if (arg !== undefined) {
      rest.push(arg);
    }
  }
  return { cacheRoot, rest };
}

export async function main(argv: readonly string[] = process.argv): Promise<void> {
  const { cacheRoot, rest } = extractCacheRoot(argv);
  const processRunner = createProcessRunner();
  const clock = systemClock;
  const deps = {
    cwd: process.cwd(),
    cacheRoot,
    fs: createNodeFileSystem(),
    processRunner,
    logger: createLogger({ level: 'info', stream: process.stderr, format: 'pretty', clock }),
    clock,
    git: createGitProvider(processRunner),
    stdout: { write: (text: string) => writeSync(process.stdout.fd, text) },
    ...(rest[1] ? { cliPath: rest[1] } : {}),
  };
  const cli = cac('sentiness');
  registerCommands(cli, deps);
  cli.help();
  cli.version(SENTINESS_VERSION);

  try {
    cli.parse(rest, { run: false });
    await cli.runMatchedCommand();
  } catch (error) {
    deps.logger.error(error instanceof Error ? error.message : 'Unknown CLI error');
    process.exitCode = 3;
  }
}

await main();

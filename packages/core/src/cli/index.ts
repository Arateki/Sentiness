#!/usr/bin/env node
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

export async function main(argv: readonly string[] = process.argv): Promise<void> {
  const processRunner = createProcessRunner();
  const clock = systemClock;
  const deps = {
    cwd: process.cwd(),
    fs: createNodeFileSystem(),
    processRunner,
    logger: createLogger({ level: 'info', stream: process.stderr, format: 'pretty', clock }),
    clock,
    git: createGitProvider(processRunner),
    stdout: { write: (text: string) => process.stdout.write(text) },
    ...(argv[1] ? { cliPath: argv[1] } : {}),
  };
  const cli = cac('sentiness');
  registerCommands(cli, deps);
  cli.help();
  cli.version(SENTINESS_VERSION);

  try {
    cli.parse([...argv], { run: false });
    await cli.runMatchedCommand();
  } catch (error) {
    deps.logger.error(error instanceof Error ? error.message : 'Unknown CLI error');
    process.exitCode = 3;
  }
}

await main();

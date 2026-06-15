#!/usr/bin/env node
import { writeSync } from 'node:fs';
import process from 'node:process';
import { run } from './bootstrap.js';
import { createLogger } from './logger.js';
import { createNodeFileSystem } from './node-fs.js';
import { createProcessRunner } from './node-process.js';

function envRecord(): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

async function main(): Promise<void> {
  const deps = {
    cwd: process.cwd(),
    env: envRecord(),
    fs: createNodeFileSystem(),
    process: createProcessRunner(),
    logger: createLogger(),
    stdout: { write: (text: string) => writeSync(process.stdout.fd, text) },
    stderr: { write: (text: string) => writeSync(process.stderr.fd, text) },
  };
  const code = await run(process.argv.slice(2), deps);
  process.exitCode = code;
}

await main();

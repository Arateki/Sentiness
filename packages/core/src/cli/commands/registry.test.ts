import {
  FakeProcessRunner,
  FixedClock,
  InMemoryFileSystem,
  InMemoryGitProvider,
  SilentLogger,
} from '@sentiness/_test-utils';
import { cac } from 'cac';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerCommands } from './registry.js';
import type { CommandDeps } from './types.js';

function makeDeps(fs: InMemoryFileSystem, stdout = vi.fn()): CommandDeps {
  return {
    cwd: '/project',
    fs,
    processRunner: new FakeProcessRunner(),
    logger: new SilentLogger(),
    clock: new FixedClock(1714348800000),
    git: new InMemoryGitProvider(),
    stdout: { write: stdout },
  };
}

async function settleActions(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe('command registry', () => {
  afterEach(() => {
    process.exitCode = undefined;
  });

  it('passes status positional jobId to the command handler', async () => {
    const fs = new InMemoryFileSystem({
      '/project/.sentiness/jobs/job-1/meta.json': JSON.stringify({
        jobId: 'job-1',
        jobDir: '/project/.sentiness/jobs/job-1',
        resultPath: '/project/.sentiness/jobs/job-1/result.json',
        pid: process.pid,
        startedAt: '2024-01-01T00:00:00.000Z',
        status: 'completed',
        command: 'node',
        args: [],
        tier: 'fast',
        exitCode: 0,
      }),
    });
    const stdout = vi.fn();
    const cli = cac('sentiness');

    registerCommands(cli, makeDeps(fs, stdout));
    cli.parse(['node', 'sentiness', 'status', 'job-1']);
    await settleActions();

    expect(stdout).toHaveBeenCalledWith(expect.stringContaining('"jobId": "job-1"'));
    expect(process.exitCode).toBe(0);
  });

  it('passes variadic pending arguments to the command handler', async () => {
    const pendingPath = '/project/.sentiness/pending-feedback.json';
    const fs = new InMemoryFileSystem({
      '/project/sentiness.config.json': JSON.stringify({
        schemaVersion: '2.0',
        engine: '2.0.0',
        checks: {},
        pending: { path: '.sentiness/pending-feedback.json' },
      }),
      [pendingPath]: JSON.stringify([
        {
          id: 'item-1',
          jobId: 'job-1',
          createdAt: '2024-01-01T00:00:00.000Z',
          tier: 'slow',
          summary: 'failed',
          reportPath: '/tmp/result.json',
          acked: false,
        },
      ]),
    });
    const stdout = vi.fn();
    const cli = cac('sentiness');

    registerCommands(cli, makeDeps(fs, stdout));
    cli.parse(['node', 'sentiness', 'pending', 'ack', 'item-1']);
    await settleActions();

    const updated = await fs.readFile(pendingPath);
    expect(updated).toContain('"acked": true');
    expect(stdout).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(0);
  });
});

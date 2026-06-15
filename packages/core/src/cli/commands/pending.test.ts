import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FakeProcessRunner,
  FixedClock,
  InMemoryGitProvider,
  SilentLogger,
} from '@sentiness/_test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNodeFileSystem } from '../../fs/node-fs.js';
import { pendingCommand } from './pending.js';
import type { CommandDeps } from './types.js';

describe('pendingCommand', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'sentiness-pending-'));
    writeFileSync(
      join(cwd, 'package.json'),
      JSON.stringify({ name: 'pending-test', type: 'module' }),
    );
    writeFileSync(
      join(cwd, 'sentiness.config.json'),
      JSON.stringify({
        schemaVersion: '2.0',
        engine: '2.0.0',
        checks: {},
        pending: { path: '.sentiness/pending-feedback.json' },
      }),
    );
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  function deps(stdout = vi.fn()): CommandDeps {
    return {
      cwd,
      fs: createNodeFileSystem(),
      processRunner: new FakeProcessRunner(),
      logger: new SilentLogger(),
      clock: new FixedClock(1714348800000),
      git: new InMemoryGitProvider(),
      stdout: { write: stdout },
    };
  }

  it('lists only unacked items by default', async () => {
    const stdout = vi.fn();
    const result = deps(stdout);
    const queue = await import('../../pending/pending.js');
    const q = new queue.PendingQueue(
      join(cwd, '.sentiness/pending-feedback.json'),
      result.fs,
      result.clock,
      result.logger,
    );
    const item = await q.enqueue({
      jobId: 'job-1',
      tier: 'fast',
      summary: 'still open',
      reportPath: '/tmp/report.json',
    });
    await q.enqueue({
      jobId: 'job-2',
      tier: 'standard',
      summary: 'old one',
      reportPath: '/tmp/old.json',
    });
    const items = await q.load();
    const ackedId = items.find((entry) => entry.jobId === 'job-2')?.id ?? '';
    await q.ack(ackedId);

    const exit = await pendingCommand({ _: [] }, result);

    expect(exit).toBe(0);
    const printed = JSON.parse(String(stdout.mock.calls[0]?.[0]));
    expect(Array.isArray(printed)).toBe(true);
    expect(printed.map((entry: { id: string }) => entry.id)).toEqual([item.id]);
  });

  it('lists every item when --all is set', async () => {
    const stdout = vi.fn();
    const result = deps(stdout);
    const queue = await import('../../pending/pending.js');
    const q = new queue.PendingQueue(
      join(cwd, '.sentiness/pending-feedback.json'),
      result.fs,
      result.clock,
      result.logger,
    );
    await q.enqueue({
      jobId: 'job-1',
      tier: 'fast',
      summary: 'open',
      reportPath: '/tmp/a.json',
    });
    const second = await q.enqueue({
      jobId: 'job-2',
      tier: 'fast',
      summary: 'closed',
      reportPath: '/tmp/b.json',
    });
    await q.ack(second.id);

    const exit = await pendingCommand({ _: [], all: true }, result);

    expect(exit).toBe(0);
    const printed = JSON.parse(String(stdout.mock.calls[0]?.[0]));
    expect(printed).toHaveLength(2);
  });

  it('acknowledges a specific item via "ack <id>"', async () => {
    const result = deps();
    const queue = await import('../../pending/pending.js');
    const q = new queue.PendingQueue(
      join(cwd, '.sentiness/pending-feedback.json'),
      result.fs,
      result.clock,
      result.logger,
    );
    const enqueued = await q.enqueue({
      jobId: 'job-1',
      tier: 'fast',
      summary: 'open',
      reportPath: '/tmp/a.json',
    });

    const exit = await pendingCommand({ _: ['ack', enqueued.id] }, result);

    expect(exit).toBe(0);
    const after = await q.load();
    expect(after[0]?.acked).toBe(true);
  });

  it('exits 1 when ack is missing an id', async () => {
    const exit = await pendingCommand({ _: ['ack'] }, deps());
    expect(exit).toBe(1);
  });

  it('exits 1 on unknown action', async () => {
    const exit = await pendingCommand({ _: ['drop'] }, deps());
    expect(exit).toBe(1);
  });
});

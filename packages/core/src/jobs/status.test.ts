import { InMemoryFileSystem } from '@sentiness/_test-utils';
import { describe, expect, it, vi } from 'vitest';
import { JobReader } from './status.js';
import type { JobMeta } from './types.js';

describe('JobReader', () => {
  function meta(overrides: Partial<JobMeta> = {}): JobMeta {
    return {
      jobId: '123',
      jobDir: '/jobs/123',
      resultPath: '/jobs/123/result.json',
      pid: process.pid,
      startedAt: '2024-01-01T00:00:00.000Z',
      status: 'completed',
      command: 'echo',
      args: [],
      tier: 'slow',
      ...overrides,
    };
  }

  function reportJson(): string {
    return JSON.stringify({
      schemaVersion: '1.0',
      sentinessVersion: '0.1.0',
      runId: 'run',
      startedAt: '2024-01-01T00:00:00.000Z',
      completedAt: '2024-01-01T00:00:01.000Z',
      durationMs: 1000,
      context: {
        cwd: '/project',
        tier: 'fast',
        trigger: null,
        mode: 'full',
        baseRef: null,
        headRef: 'HEAD',
        changedFiles: [],
        addedDependencies: [],
        removedDependencies: [],
      },
      summary: {
        status: 'ok',
        totals: { error: 0, warning: 0, info: 0 },
        newInDiff: { error: 0, warning: 0, info: 0 },
        blocking: false,
        topIssues: [],
        checksRun: 0,
        checksSkipped: 0,
        checksErrored: 0,
      },
      checks: [],
      trend: { available: false, reason: 'no metric baseline regressions' },
      baseline: { applied: false, mode: 'none', path: '', suppressedFindings: 0 },
      agentInstructions: { blocking: false, mustFix: [], shouldFix: [], informational: [] },
    });
  }

  it('reads existing job meta correctly', async () => {
    const fs = new InMemoryFileSystem();
    const reader = new JobReader('/jobs', fs);
    const jobMeta = meta({ pid: 99999999 });

    await fs.mkdir('/jobs/123', { recursive: true });
    await fs.writeFile('/jobs/123/meta.json', JSON.stringify(jobMeta));

    const result = await reader.read('123');
    expect(result).toEqual(jobMeta);
  });

  it('read is pure and does not mutate meta.json for orphaned jobs', async () => {
    const fs = new InMemoryFileSystem();
    const reader = new JobReader('/jobs', fs);
    const jobMeta = meta({ pid: 99999999, status: 'running' });

    await fs.mkdir('/jobs/123', { recursive: true });
    await fs.writeFile('/jobs/123/meta.json', JSON.stringify(jobMeta));

    const result = await reader.read('123');
    expect(result?.status).toBe('running');
    const stored = await fs.readFile('/jobs/123/meta.json');
    expect(stored).not.toContain('"status": "failed"');
  });

  it('reconcile detects orphaned jobs and updates meta.json', async () => {
    const fs = new InMemoryFileSystem();
    const reader = new JobReader('/jobs', fs);
    const jobMeta = meta({ pid: 99999999, status: 'running' });

    await fs.mkdir('/jobs/123', { recursive: true });
    await fs.writeFile('/jobs/123/meta.json', JSON.stringify(jobMeta));

    const result = await reader.reconcile('123');
    expect(result?.status).toBe('failed');
    expect(result?.exitCode).toBe(-1);
    await expect(fs.readFile('/jobs/123/meta.json')).resolves.toContain('"status": "failed"');
  });

  it('returns undefined for unknown jobId', async () => {
    const fs = new InMemoryFileSystem();
    const reader = new JobReader('/jobs', fs);
    expect(await reader.read('unknown')).toBeUndefined();
  });

  it('truncates logs properly', async () => {
    const fs = new InMemoryFileSystem();
    const reader = new JobReader('/jobs', fs);
    await fs.mkdir('/jobs/123', { recursive: true });

    // Create a 100-byte log file
    const logData = 'A'.repeat(100);
    await fs.writeFile('/jobs/123/stdout.log', logData);

    const fullLog = await reader.readLogs('123', 'stdout', 200);
    expect(fullLog.length).toBe(100);
    expect(fullLog).toBe('A'.repeat(100));

    // Truncate to 10 bytes
    const logData2 = 'A'.repeat(90) + 'B'.repeat(10);
    await fs.writeFile('/jobs/123/stdout.log', logData2);
    const truncatedLog = await reader.readLogs('123', 'stdout', 10);
    expect(truncatedLog.length).toBe(10);
    expect(truncatedLog).toBe('B'.repeat(10));
  });

  it('lists jobs and filters by status', async () => {
    const fs = new InMemoryFileSystem();
    const reader = new JobReader('/jobs', fs);

    await fs.mkdir('/jobs/1', { recursive: true });
    await fs.writeFile(
      '/jobs/1/meta.json',
      JSON.stringify(
        meta({
          jobId: '1',
          jobDir: '/jobs/1',
          resultPath: '/jobs/1/result.json',
          status: 'completed',
          startedAt: '2024-01-01T00:00:00.000Z',
        }),
      ),
    );

    await fs.mkdir('/jobs/2', { recursive: true });
    await fs.writeFile(
      '/jobs/2/meta.json',
      JSON.stringify(
        meta({
          jobId: '2',
          jobDir: '/jobs/2',
          resultPath: '/jobs/2/result.json',
          status: 'running',
          startedAt: '2024-01-02T00:00:00.000Z',
        }),
      ),
    );

    // File not directory
    await fs.writeFile('/jobs/file.txt', 'data');

    const allJobs = await reader.list();
    expect(allJobs).toHaveLength(2);
    expect(allJobs[0]?.jobId).toBe('2');

    const completedJobs = await reader.list({ status: 'completed' });
    expect(completedJobs).toHaveLength(1);
    expect(completedJobs[0]?.jobId).toBe('1');

    const runningJobs = await reader.list({ status: 'running' });
    expect(runningJobs).toHaveLength(1);
    expect(runningJobs[0]?.jobId).toBe('2');
  });

  it('returns empty list if jobsDir does not exist', async () => {
    const fs = new InMemoryFileSystem();
    const reader = new JobReader('/jobs', fs);
    expect(await reader.list()).toEqual([]);
  });

  it('returns undefined if result.json does not exist', async () => {
    const fs = new InMemoryFileSystem();
    const reader = new JobReader('/jobs', fs);
    expect(await reader.readResult('123')).toBeUndefined();
  });

  it('returns parsed result.json if exists', async () => {
    const fs = new InMemoryFileSystem();
    const reader = new JobReader('/jobs', fs);
    await fs.mkdir('/jobs/123', { recursive: true });
    await fs.writeFile('/jobs/123/result.json', reportJson());

    const result = await reader.readResult('123');
    expect(result?.summary.status).toBe('ok');
  });

  it('returns undefined for malformed job metadata', async () => {
    const fs = new InMemoryFileSystem();
    const reader = new JobReader('/jobs', fs);
    await fs.mkdir('/jobs/123', { recursive: true });
    await fs.writeFile('/jobs/123/meta.json', JSON.stringify({ jobId: '123' }));

    expect(await reader.read('123')).toBeUndefined();
  });

  it('reconcile treats EPERM as alive (process exists but no permission to signal)', async () => {
    const originalKill = process.kill;
    process.kill = vi.fn().mockImplementation(() => {
      const err = new Error('EPERM');
      Object.assign(err, { code: 'EPERM' });
      throw err;
    });

    try {
      const fs = new InMemoryFileSystem();
      const reader = new JobReader('/jobs', fs);
      const jobMeta = meta({ pid: 99999999, status: 'running' });

      await fs.mkdir('/jobs/123', { recursive: true });
      await fs.writeFile('/jobs/123/meta.json', JSON.stringify(jobMeta));

      const result = await reader.reconcile('123');
      expect(result?.status).toBe('running');
    } finally {
      process.kill = originalKill;
    }
  });
});

import { InMemoryFileSystem } from '@sentiness/_test-utils';
import { describe, expect, it, vi } from 'vitest';
import { JobReader } from './status.js';
import type { JobMeta } from './types.js';

describe('JobReader', () => {
  it('reads existing job meta correctly', async () => {
    const fs = new InMemoryFileSystem();
    const reader = new JobReader('/jobs', fs);
    const meta: JobMeta = {
      jobId: '123',
      jobDir: '/jobs/123',
      resultPath: '/jobs/123/result.json',
      pid: 99999999, // Some non-existent PID
      startedAt: '2024-01-01T00:00:00.000Z',
      status: 'completed',
      command: 'echo',
      args: [],
      tier: 'slow',
    };

    await fs.mkdir('/jobs/123', { recursive: true });
    await fs.writeFile('/jobs/123/meta.json', JSON.stringify(meta));

    const result = await reader.read('123');
    expect(result).toEqual(meta);
  });

  it('detects orphaned jobs by checking PID liveness', async () => {
    const fs = new InMemoryFileSystem();
    const reader = new JobReader('/jobs', fs);
    const meta: JobMeta = {
      jobId: '123',
      jobDir: '/jobs/123',
      resultPath: '/jobs/123/result.json',
      pid: 99999999, // Process does not exist
      startedAt: '2024-01-01T00:00:00.000Z',
      status: 'running',
      command: 'echo',
      args: [],
      tier: 'slow',
    };

    await fs.mkdir('/jobs/123', { recursive: true });
    await fs.writeFile('/jobs/123/meta.json', JSON.stringify(meta));

    const result = await reader.read('123');
    expect(result?.status).toBe('failed');
    expect(result?.exitCode).toBe(-1);
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
      JSON.stringify({ jobId: '1', status: 'completed', pid: 1, tier: 'slow' }),
    );

    await fs.mkdir('/jobs/2', { recursive: true });
    await fs.writeFile(
      '/jobs/2/meta.json',
      JSON.stringify({ jobId: '2', status: 'running', pid: process.pid, tier: 'slow' }),
    );

    // File not directory
    await fs.writeFile('/jobs/file.txt', 'data');

    const allJobs = await reader.list();
    expect(allJobs).toHaveLength(2);

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
    await fs.writeFile('/jobs/123/result.json', JSON.stringify({ summary: { status: 'ok' } }));

    const result = await reader.readResult('123');
    expect(result?.summary.status).toBe('ok');
  });

  it('handles EPERM correctly as alive', async () => {
    // We mock process.kill to throw EPERM
    const originalKill = process.kill;
    process.kill = vi.fn().mockImplementation(() => {
      const err = new Error('EPERM');
      Object.assign(err, { code: 'EPERM' });
      throw err;
    });

    try {
      const fs = new InMemoryFileSystem();
      const reader = new JobReader('/jobs', fs);
      const meta: JobMeta = {
        jobId: '123',
        jobDir: '/jobs/123',
        resultPath: '/jobs/123/result.json',
        pid: 99999999, // Mocked to EPERM
        startedAt: '2024-01-01T00:00:00.000Z',
        status: 'running',
        command: 'echo',
        args: [],
        tier: 'slow',
      };

      await fs.mkdir('/jobs/123', { recursive: true });
      await fs.writeFile('/jobs/123/meta.json', JSON.stringify(meta));

      const result = await reader.read('123');
      expect(result?.status).toBe('running');
    } finally {
      process.kill = originalKill;
    }
  });
});

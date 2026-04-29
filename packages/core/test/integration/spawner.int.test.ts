import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
import { FixedClock } from '@sentiness/_test-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createNodeFileSystem } from '../../src/fs/node-fs.js';
import { JobSpawner } from '../../src/jobs/spawner.js';

describe('JobSpawner (Integration)', () => {
  const jobsDir = join(process.cwd(), '.sentiness-test-jobs');
  const fs = createNodeFileSystem();
  const clock = new FixedClock(Date.now());

  beforeAll(async () => {
    await fs.mkdir(jobsDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(jobsDir, { recursive: true, force: true });
  });

  it('spawns a real process detached without blocking', async () => {
    const spawner = new JobSpawner(jobsDir, fs, clock);

    const start = Date.now();
    const meta = await spawner.spawn('node', ['-e', 'setTimeout(() => process.exit(0), 100)'], {
      cwd: process.cwd(),
      tier: 'slow',
    });
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(100); // Should return immediately, not wait for the 100ms job
    expect(meta.pid).toBeGreaterThan(0);
    expect(meta.status).toBe('running');

    // Verify the log files were really created by real file system
    const stdoutContent = await fs.readFile(join(meta.jobDir, 'stdout.log'));
    expect(stdoutContent).toBe(''); // It's empty initially
  });
});

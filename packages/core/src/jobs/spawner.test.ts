import { spawn } from 'node:child_process';
import { open } from 'node:fs/promises';
import { FixedClock, InMemoryFileSystem } from '@sentiness/_test-utils';
import { describe, expect, it, vi } from 'vitest';
import { JobSpawner } from './spawner.js';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  open: vi.fn(),
}));

describe('JobSpawner (Unit)', () => {
  it('should spawn a job and return meta immediately', async () => {
    const fs = new InMemoryFileSystem();
    const clock = new FixedClock(1714348800000);
    const spawner = new JobSpawner('/jobs', fs, clock);

    const mockUnref = vi.fn();
    vi.mocked(spawn).mockReturnValue({
      pid: 12345,
      unref: mockUnref,
    } as unknown as ReturnType<typeof spawn>);

    const mockClose = vi.fn();
    vi.mocked(open).mockResolvedValue({
      fd: 99,
      close: mockClose,
    } as unknown as import('node:fs/promises').FileHandle);

    const meta = await spawner.spawn('echo', ['hello'], { cwd: '/project', tier: 'slow' });

    expect(meta.command).toBe('echo');
    expect(meta.args).toEqual(['hello']);
    expect(meta.pid).toBe(12345);
    expect(meta.status).toBe('running');
    expect(meta.tier).toBe('slow');
    expect(meta.jobId).toBeDefined();

    // Check directory and meta.json
    const jobFiles = await fs.readDir(meta.jobDir);
    expect(jobFiles).toContain('meta.json');
    expect(jobFiles).toContain('stdout.log');
    expect(jobFiles).toContain('stderr.log');

    const metaContent = await fs.readFile(`${meta.jobDir}/meta.json`);
    expect(JSON.parse(metaContent)).toEqual(meta);

    // Verify unref was called
    expect(mockUnref).toHaveBeenCalled();
    // Verify file descriptors were closed
    expect(mockClose).toHaveBeenCalledTimes(2);
  });
});

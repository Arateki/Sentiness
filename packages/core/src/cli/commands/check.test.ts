import { spawn } from 'node:child_process';
import { open } from 'node:fs/promises';
import {
  FakeProcessRunner,
  FixedClock,
  InMemoryFileSystem,
  InMemoryGitProvider,
  SilentLogger,
} from '@sentiness/_test-utils';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../../config/config.js';
import { checkCommand } from './check.js';
import type { CommandDeps } from './types.js';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  open: vi.fn(),
}));

function makeDeps(fs: InMemoryFileSystem, stdout = vi.fn()): CommandDeps {
  return {
    cwd: '/project',
    cacheRoot: '/home/u/.sentiness',
    fs,
    processRunner: new FakeProcessRunner(),
    logger: new SilentLogger(),
    clock: new FixedClock(1714348800000),
    git: new InMemoryGitProvider(),
    stdout: { write: stdout },
    cliPath: '/project/packages/core/dist/cli/index.js',
  };
}

describe('checkCommand', () => {
  it('lets trigger-only runs resolve the tier from config', async () => {
    const fs = new InMemoryFileSystem({
      '/project/sentiness.config.json': JSON.stringify(DEFAULT_CONFIG),
    });
    const stdout = vi.fn();

    const exitCode = await checkCommand(
      { trigger: 'post-edit', compact: true },
      makeDeps(fs, stdout),
    );

    expect(exitCode).toBe(0);
    const report = JSON.parse(String(stdout.mock.calls[0]?.[0]));
    expect(report.context.tier).toBe('fast');
    expect(report.context.trigger).toBe('post-edit');
  });

  it('spawns background jobs with concrete job paths before the child starts', async () => {
    const originalArgv = process.argv;
    process.argv = [
      'node',
      '/project/packages/core/dist/cli/index.js',
      'check',
      '--background',
      '--tier=fast',
    ];

    try {
      const fs = new InMemoryFileSystem({
        '/project/sentiness.config.json': JSON.stringify(DEFAULT_CONFIG),
      });
      const stdout = vi.fn();
      const mockUnref = vi.fn();
      const mockClose = vi.fn();

      vi.mocked(spawn).mockReturnValue({
        pid: 12345,
        unref: mockUnref,
      } as unknown as ReturnType<typeof spawn>);
      vi.mocked(open).mockResolvedValue({
        fd: 99,
        close: mockClose,
      } as unknown as import('node:fs/promises').FileHandle);

      const exitCode = await checkCommand({ background: true, tier: 'fast' }, makeDeps(fs, stdout));

      expect(exitCode).toBe(0);
      const response = JSON.parse(String(stdout.mock.calls[0]?.[0]));
      expect(typeof response.jobId).toBe('string');

      const metaPath = `/project/.sentiness/jobs/${response.jobId}/meta.json`;
      const meta = JSON.parse(await fs.readFile(metaPath));
      expect(meta.args).toContain('/project/packages/core/dist/cli/index.js');
      expect(meta.args).toContain(
        `--output=/project/.sentiness/jobs/${response.jobId}/result.json`,
      );
      expect(meta.args).toContain(`--job-id=${response.jobId}`);
      expect(meta.args).not.toContain('--background');
      expect(JSON.stringify(meta.args)).not.toContain('<jobId>');
      expect(mockUnref).toHaveBeenCalled();
    } finally {
      process.argv = originalArgv;
    }
  });

  it('treats camel-cased jobId as the internal background job id', async () => {
    const fs = new InMemoryFileSystem({
      '/project/sentiness.config.json': JSON.stringify(DEFAULT_CONFIG),
      '/project/.sentiness/jobs/job-1/meta.json': JSON.stringify({
        jobId: 'job-1',
        jobDir: '/project/.sentiness/jobs/job-1',
        resultPath: '/project/.sentiness/jobs/job-1/result.json',
        pid: process.pid,
        startedAt: '2024-01-01T00:00:00.000Z',
        status: 'running',
        command: 'node',
        args: [],
        tier: 'fast',
      }),
    });
    const stdout = vi.fn();

    const exitCode = await checkCommand(
      {
        tier: 'fast',
        compact: true,
        output: '.sentiness/jobs/job-1/result.json',
        jobId: 'job-1',
      },
      makeDeps(fs, stdout),
    );

    expect(exitCode).toBe(0);
    expect(stdout).not.toHaveBeenCalled();
    expect(await fs.exists('/project/.sentiness/jobs/job-1/result.json')).toBe(true);
    const meta = JSON.parse(await fs.readFile('/project/.sentiness/jobs/job-1/meta.json'));
    expect(meta.status).toBe('completed');
    expect(meta.exitCode).toBe(0);
  });

  it('marks trend mode when requested', async () => {
    const fs = new InMemoryFileSystem({
      '/project/sentiness.config.json': JSON.stringify(DEFAULT_CONFIG),
    });
    const stdout = vi.fn();

    const exitCode = await checkCommand(
      { tier: 'fast', trend: true, compact: true },
      makeDeps(fs, stdout),
    );

    expect(exitCode).toBe(0);
    const report = JSON.parse(String(stdout.mock.calls[0]?.[0]));
    expect(report.context.mode).toBe('trend');
  });
});

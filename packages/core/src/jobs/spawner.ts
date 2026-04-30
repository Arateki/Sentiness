import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import type { Clock, FileSystem } from '@sentiness/check-sdk';
import type { JobMeta, SpawnOptions } from './types.js';

export class JobSpawner {
  constructor(
    private readonly jobsDir: string,
    private readonly fs: FileSystem,
    private readonly clock: Clock,
  ) {}

  async spawn(command: string, args: readonly string[], options: SpawnOptions): Promise<JobMeta> {
    // Generate jobId via node:crypto
    const jobId = options.jobId ?? randomUUID();
    const jobDir = join(this.jobsDir, jobId);

    // Create <jobsDir>/<jobId>/
    await this.fs.mkdir(jobDir, { recursive: true });

    const stdoutPath = join(jobDir, 'stdout.log');
    const stderrPath = join(jobDir, 'stderr.log');
    const resultPath = join(jobDir, 'result.json');
    const metaPath = join(jobDir, 'meta.json');

    // Initialize log files via the injected FileSystem so in-memory test doubles track their
    // existence. In production `open(path, 'a')` below would create them regardless.
    await this.fs.writeFile(stdoutPath, '');
    await this.fs.writeFile(stderrPath, '');

    // The explicit Node process/file I/O boundary
    const stdoutFile = await open(stdoutPath, 'a');
    const stderrFile = await open(stderrPath, 'a');

    const env = options.env ? { ...process.env, ...options.env } : process.env;

    const child = spawn(command, args, {
      cwd: options.cwd,
      env,
      detached: true,
      stdio: ['ignore', stdoutFile.fd, stderrFile.fd],
    });

    // Unref so parent can exit while child runs
    child.unref();

    await stdoutFile.close();
    await stderrFile.close();

    if (child.pid === undefined) {
      throw new Error(`Failed to spawn child process for command: ${command}`);
    }

    const meta: JobMeta = {
      jobId,
      jobDir,
      resultPath,
      pid: child.pid,
      startedAt: this.clock.isoNow(),
      status: 'running',
      command,
      args,
      tier: options.tier,
    };

    // Write meta.json
    await this.fs.writeFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`);

    return meta;
  }
}

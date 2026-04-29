import { join } from 'node:path';
import type { FileSystem, Logger } from '@sentiness/check-sdk';
import { type Report, ReportSchema } from '../schema/report.js';
import { type JobMeta, JobMetaSchema, type JobStatus } from './types.js';

function normalizeJobMeta(meta: ReturnType<typeof JobMetaSchema.parse>): JobMeta {
  return {
    jobId: meta.jobId,
    jobDir: meta.jobDir,
    resultPath: meta.resultPath,
    pid: meta.pid,
    startedAt: meta.startedAt,
    status: meta.status,
    command: meta.command,
    args: meta.args,
    tier: meta.tier,
    ...(meta.completedAt !== undefined ? { completedAt: meta.completedAt } : {}),
    ...(meta.exitCode !== undefined ? { exitCode: meta.exitCode } : {}),
  };
}

export class JobReader {
  constructor(
    private readonly jobsDir: string,
    private readonly fs: FileSystem,
    private readonly logger?: Logger,
  ) {}

  private isAlive(pid: number): boolean {
    try {
      return process.kill(pid, 0);
    } catch (e: unknown) {
      if (e && typeof e === 'object' && 'code' in e) {
        return e.code === 'EPERM'; // EPERM means process exists but we don't have permission to signal it
      }
      return false; // ESRCH or other error means process does not exist
    }
  }

  async read(jobId: string): Promise<JobMeta | undefined> {
    const metaPath = join(this.jobsDir, jobId, 'meta.json');
    if (!(await this.fs.exists(metaPath))) {
      return undefined;
    }

    try {
      const content = await this.fs.readFile(metaPath);
      const meta = normalizeJobMeta(JobMetaSchema.parse(JSON.parse(content)));

      if (meta.status === 'running') {
        if (!this.isAlive(meta.pid)) {
          const updated = { ...meta, status: 'failed' as const, exitCode: -1 };
          await this.fs.writeFile(metaPath, `${JSON.stringify(updated, null, 2)}\n`);
          return updated;
        }
      }

      return meta;
    } catch (error) {
      this.logger?.warn(`Failed to read job metadata for ${jobId}`, {
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  async readResult(jobId: string): Promise<Report | undefined> {
    const resultPath = join(this.jobsDir, jobId, 'result.json');
    if (!(await this.fs.exists(resultPath))) {
      return undefined;
    }

    try {
      const content = await this.fs.readFile(resultPath);
      return ReportSchema.parse(JSON.parse(content));
    } catch (error) {
      this.logger?.warn(`Failed to read job result for ${jobId}`, {
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  async list(filter?: { readonly status?: JobStatus }): Promise<readonly JobMeta[]> {
    if (!(await this.fs.exists(this.jobsDir))) {
      return [];
    }

    const entries = await this.fs.readDir(this.jobsDir);
    const jobs: JobMeta[] = [];

    for (const entry of entries) {
      const stat = await this.fs.stat(join(this.jobsDir, entry));
      if (!stat.isDirectory) {
        continue;
      }
      const meta = await this.read(entry);
      if (meta) {
        if (!filter?.status || meta.status === filter.status) {
          jobs.push(meta);
        }
      }
    }

    return [...jobs].sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  }

  async readLogs(
    jobId: string,
    stream: 'stdout' | 'stderr',
    maxBytes = 64 * 1024,
  ): Promise<string> {
    const logPath = join(this.jobsDir, jobId, `${stream}.log`);
    if (!(await this.fs.exists(logPath))) {
      return '';
    }

    const content = await this.fs.readFile(logPath);
    const buffer = Buffer.from(content, 'utf8');

    if (buffer.length <= maxBytes) {
      return content;
    }

    const start = buffer.length - maxBytes;
    return buffer.subarray(start).toString('utf8');
  }
}

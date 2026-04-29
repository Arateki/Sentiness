import type { Tier } from '@sentiness/check-sdk';

export type JobStatus = 'running' | 'completed' | 'failed' | 'timed_out' | 'cancelled';

export interface JobMeta {
  readonly jobId: string;
  readonly jobDir: string;
  readonly resultPath: string;
  readonly pid: number;
  readonly startedAt: string;
  readonly status: JobStatus;
  readonly command: string;
  readonly args: readonly string[];
  readonly tier: Tier;
  readonly completedAt?: string;
  readonly exitCode?: number;
}

export interface SpawnOptions {
  readonly cwd: string;
  readonly tier: Tier;
  readonly env?: Readonly<Record<string, string>>;
  readonly jobId?: string;
}

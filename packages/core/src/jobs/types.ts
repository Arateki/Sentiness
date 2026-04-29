import type { Tier } from '@sentiness/check-sdk';
import { z } from 'zod';

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

export const JobMetaSchema = z.object({
  jobId: z.string().min(1),
  jobDir: z.string().min(1),
  resultPath: z.string().min(1),
  pid: z.number().int(),
  startedAt: z.string().min(1),
  status: z.enum(['running', 'completed', 'failed', 'timed_out', 'cancelled']),
  command: z.string().min(1),
  args: z.array(z.string()),
  tier: z.enum(['fast', 'standard', 'slow']),
  completedAt: z.string().optional(),
  exitCode: z.number().int().optional(),
});

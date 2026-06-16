import { z } from 'zod';

const LockToolSchema = z.object({
  name: z.string(),
  ecosystem: z.enum(['npm', 'host']),
  version: z.string().optional(),
  integrity: z.string().optional(),
  detectedVersion: z.string().optional(),
  supported: z.string().optional(),
});

const LockCheckSchema = z.object({
  version: z.string().optional(),
  path: z.string().optional(),
  integrity: z.string().optional(),
  tool: LockToolSchema.optional(),
});

export const LockSchema = z.object({
  lockfileVersion: z.literal(1),
  engine: z.object({ version: z.string(), integrity: z.string().optional() }),
  checks: z.record(z.string(), LockCheckSchema),
});

export type LockTool = z.infer<typeof LockToolSchema>;
export type LockCheck = z.infer<typeof LockCheckSchema>;
export type SentinessLock = z.infer<typeof LockSchema>;

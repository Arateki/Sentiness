// When bumping schemaVersion to '1.1' or higher: add a pre-parse step in baseline.ts that reads
// the raw `schemaVersion` field and throws a clear error like "Baseline uses schema 1.1; upgrade
// Sentiness to read it" rather than a generic ZodError. This avoids silent data loss for users
// who downgrade Sentiness after already writing a newer baseline.
import { z } from 'zod';

const BaselineEntrySchema = z.object({
  checkId: z.string().min(1),
  ruleId: z.string().min(1),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  location: z.object({
    file: z.string().min(1),
    startLine: z.number().int().positive().optional(),
  }),
  addedAt: z.string().min(1),
  reason: z.string(),
});

const MetricBaselineSchema = z.object({
  value: z.number(),
  direction: z.enum(['higher-is-better', 'lower-is-better']),
});

export const BaselineSnapshotSchema = z.object({
  schemaVersion: z.literal('1.0'),
  createdAt: z.string().min(1),
  createdAtCommit: z.string().min(1),
  suppressed: z.array(BaselineEntrySchema),
  metrics: z.record(z.string(), MetricBaselineSchema),
});

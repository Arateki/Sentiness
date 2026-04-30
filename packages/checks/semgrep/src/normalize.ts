import { z } from 'zod';

export type NormalizedSemgrepFinding = {
  readonly ruleId: string;
  readonly severity: 'error' | 'warning' | 'info';
  readonly message: string;
  readonly file: string;
  readonly startLine?: number;
  readonly startColumn?: number;
  readonly endLine?: number;
  readonly endColumn?: number;
  readonly fingerprintHint?: string;
  readonly references?: readonly string[];
};

const PositionSchema = z
  .object({
    line: z.number().optional(),
    col: z.number().optional(),
    column: z.number().optional(),
  })
  .catchall(z.unknown());

const ExtraSchema = z
  .object({
    message: z.string().optional(),
    severity: z.string().optional(),
    fingerprint: z.string().optional(),
    metadata: z
      .object({
        references: z.array(z.string()).optional(),
        source: z.string().optional(),
        shortlink: z.string().optional(),
      })
      .catchall(z.unknown())
      .optional(),
  })
  .catchall(z.unknown());

const SemgrepResultSchema = z
  .object({
    check_id: z.string().optional(),
    path: z.string().optional(),
    start: PositionSchema.optional(),
    end: PositionSchema.optional(),
    extra: ExtraSchema.optional(),
  })
  .catchall(z.unknown());

const SemgrepOutputSchema = z
  .object({
    results: z.array(SemgrepResultSchema).optional(),
    errors: z.array(z.unknown()).optional(),
  })
  .catchall(z.unknown());

function normalizeSeverity(value: string | undefined): 'error' | 'warning' | 'info' {
  const normalized = value?.toLowerCase();
  if (normalized === 'error') {
    return 'error';
  }
  if (normalized === 'info' || normalized === 'inventory' || normalized === 'experiment') {
    return 'info';
  }
  return 'warning';
}

function positiveInt(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function referencesFrom(extra: z.infer<typeof ExtraSchema> | undefined): readonly string[] {
  const references = [
    ...(extra?.metadata?.references ?? []),
    ...(extra?.metadata?.shortlink ? [extra.metadata.shortlink] : []),
  ];
  return [...new Set(references)];
}

export function normalizeSemgrepOutput(output: unknown): readonly NormalizedSemgrepFinding[] {
  const parsed = SemgrepOutputSchema.parse(output);
  return (parsed.results ?? []).flatMap((result) => {
    if (!result.path || !result.check_id) {
      return [];
    }
    const refs = referencesFrom(result.extra);
    const startLine = positiveInt(result.start?.line);
    const startColumn = positiveInt(result.start?.col ?? result.start?.column);
    const endLine = positiveInt(result.end?.line);
    const endColumn = positiveInt(result.end?.col ?? result.end?.column);
    return [
      {
        ruleId: result.check_id,
        severity: normalizeSeverity(result.extra?.severity),
        message: result.extra?.message ?? `Semgrep finding: ${result.check_id}`,
        file: result.path,
        ...(startLine ? { startLine } : {}),
        ...(startColumn ? { startColumn } : {}),
        ...(endLine ? { endLine } : {}),
        ...(endColumn ? { endColumn } : {}),
        ...(result.extra?.fingerprint ? { fingerprintHint: result.extra.fingerprint } : {}),
        ...(refs.length > 0 ? { references: refs } : {}),
      },
    ];
  });
}

export function semgrepErrors(output: unknown): readonly unknown[] {
  const parsed = SemgrepOutputSchema.parse(output);
  return parsed.errors ?? [];
}

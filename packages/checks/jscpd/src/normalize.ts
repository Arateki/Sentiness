import { z } from 'zod';

export type NormalizedJscpdDuplicate = {
  readonly ruleId: 'duplicated-code';
  readonly severity: 'warning';
  readonly message: string;
  readonly file: string;
  readonly startLine?: number;
  readonly startColumn?: number;
  readonly endLine?: number;
  readonly endColumn?: number;
  readonly pairedFile?: string;
  readonly lines?: number;
  readonly tokens?: number;
  readonly snippet?: string;
};

export type JscpdMetrics = {
  readonly duplicatedLines?: number;
  readonly duplicatedTokens?: number;
  readonly duplicationPercentage?: number;
};

const PositionSchema = z
  .object({
    line: z.number().optional(),
    column: z.number().optional(),
    col: z.number().optional(),
  })
  .catchall(z.unknown());

const CloneFragmentSchema = z
  .object({
    name: z.string().optional(),
    sourceId: z.string().optional(),
    start: PositionSchema.optional(),
    end: PositionSchema.optional(),
    lines: z.number().optional(),
    tokens: z.number().optional(),
  })
  .catchall(z.unknown());

const DuplicateSchema = z
  .object({
    firstFile: CloneFragmentSchema.optional(),
    secondFile: CloneFragmentSchema.optional(),
    fragment: z.string().optional(),
    lines: z.number().optional(),
    tokens: z.number().optional(),
  })
  .catchall(z.unknown());

const StatisticSchema = z
  .object({
    total: z
      .object({
        lines: z.number().optional(),
        tokens: z.number().optional(),
        percentage: z.number().optional(),
        percentageDuplicated: z.number().optional(),
      })
      .catchall(z.unknown())
      .optional(),
  })
  .catchall(z.unknown());

const JscpdOutputSchema = z
  .object({
    duplicates: z.array(DuplicateSchema).optional(),
    statistics: StatisticSchema.optional(),
  })
  .catchall(z.unknown());

function positiveInt(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function fileName(fragment: z.infer<typeof CloneFragmentSchema> | undefined): string | undefined {
  return fragment?.name ?? fragment?.sourceId;
}

function metricValue(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function normalizeJscpdOutput(output: unknown): readonly NormalizedJscpdDuplicate[] {
  const parsed = JscpdOutputSchema.parse(output);
  return (parsed.duplicates ?? []).flatMap((duplicate) => {
    const first = duplicate.firstFile;
    const second = duplicate.secondFile;
    const file = fileName(first);
    if (!file) {
      return [];
    }
    const pairedFile = fileName(second);
    const lines = duplicate.lines ?? first?.lines ?? second?.lines;
    const tokens = duplicate.tokens ?? first?.tokens ?? second?.tokens;
    const startLine = positiveInt(first?.start?.line);
    const startColumn = positiveInt(first?.start?.column ?? first?.start?.col);
    const endLine = positiveInt(first?.end?.line);
    const endColumn = positiveInt(first?.end?.column ?? first?.end?.col);
    return [
      {
        ruleId: 'duplicated-code' as const,
        severity: 'warning' as const,
        message: `Duplicated code${pairedFile ? ` between ${file} and ${pairedFile}` : ` in ${file}`}${
          lines ? ` (${lines} lines)` : ''
        }`,
        file,
        ...(startLine ? { startLine } : {}),
        ...(startColumn ? { startColumn } : {}),
        ...(endLine ? { endLine } : {}),
        ...(endColumn ? { endColumn } : {}),
        ...(pairedFile ? { pairedFile } : {}),
        ...(lines ? { lines } : {}),
        ...(tokens ? { tokens } : {}),
        ...(duplicate.fragment ? { snippet: duplicate.fragment } : {}),
      },
    ];
  });
}

export function jscpdMetrics(output: unknown): JscpdMetrics {
  const parsed = JscpdOutputSchema.parse(output);
  const total = parsed.statistics?.total;
  const duplicatedLines = metricValue(total?.lines);
  const duplicatedTokens = metricValue(total?.tokens);
  const duplicationPercentage = metricValue(total?.percentageDuplicated ?? total?.percentage);
  return {
    ...(duplicatedLines !== undefined ? { duplicatedLines } : {}),
    ...(duplicatedTokens !== undefined ? { duplicatedTokens } : {}),
    ...(duplicationPercentage !== undefined ? { duplicationPercentage } : {}),
  };
}

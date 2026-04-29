import { z } from 'zod';

export type NormalizedBiomeDiagnostic = {
  readonly ruleId: string;
  readonly severity: 'error' | 'warning' | 'info';
  readonly message: string;
  readonly file: string;
  readonly startLine?: number;
  readonly startColumn?: number;
};

const BiomeOutputSchema = z
  .object({
    diagnostics: z.array(z.unknown()).optional(),
  })
  .passthrough();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readString(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function normalizeSeverity(value: unknown): 'error' | 'warning' | 'info' {
  if (value === 'error' || value === 'warning' || value === 'info') {
    return value;
  }
  if (value === 'warn') {
    return 'warning';
  }
  return 'warning';
}

function locationRecord(diagnostic: Record<string, unknown>): Record<string, unknown> {
  const location = diagnostic.location;
  return isRecord(location) ? location : {};
}

function fileFromLocation(location: Record<string, unknown>): string | undefined {
  const path = location.path;
  if (isRecord(path)) {
    return readString(path, ['file', 'path']);
  }
  return readString(location, ['file', 'path']);
}

function lineFromLocation(location: Record<string, unknown>): number | undefined {
  const start = location.start;
  if (isRecord(start)) {
    return readNumber(start.line);
  }
  return readNumber(location.line) ?? readNumber(location.startLine);
}

function columnFromLocation(location: Record<string, unknown>): number | undefined {
  const start = location.start;
  if (isRecord(start)) {
    return readNumber(start.column);
  }
  return readNumber(location.column) ?? readNumber(location.startColumn);
}

function normalizeDiagnostic(value: unknown): NormalizedBiomeDiagnostic | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const location = locationRecord(value);
  const file = fileFromLocation(location);
  if (!file) {
    return undefined;
  }
  const startLine = lineFromLocation(location);
  const startColumn = columnFromLocation(location);
  return {
    ruleId: readString(value, ['category', 'rule', 'code']) ?? 'biome',
    severity: normalizeSeverity(value.severity),
    message: readString(value, ['message', 'description']) ?? 'Biome diagnostic',
    file,
    ...(startLine ? { startLine } : {}),
    ...(startColumn ? { startColumn } : {}),
  };
}

export function normalizeBiomeOutput(output: unknown): readonly NormalizedBiomeDiagnostic[] {
  const parsed = BiomeOutputSchema.parse(output);
  return (parsed.diagnostics ?? []).flatMap((diagnostic) => {
    const normalized = normalizeDiagnostic(diagnostic);
    return normalized ? [normalized] : [];
  });
}

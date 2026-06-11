import { isAbsolute, relative } from 'node:path';
import { z } from 'zod';

export type NormalizedEslintDiagnostic = {
  readonly ruleId: string;
  readonly severity: 'error' | 'warning';
  readonly message: string;
  readonly file: string;
  readonly startLine?: number;
  readonly startColumn?: number;
  readonly endLine?: number;
  readonly endColumn?: number;
};

const MessageSchema = z
  .object({
    ruleId: z.string().nullable().optional(),
    severity: z.number().optional(),
    message: z.string().optional(),
    line: z.number().optional(),
    column: z.number().optional(),
    endLine: z.number().optional(),
    endColumn: z.number().optional(),
    fatal: z.boolean().optional(),
  })
  .catchall(z.unknown());

const ResultSchema = z
  .object({
    filePath: z.string(),
    messages: z.array(z.unknown()).optional(),
  })
  .catchall(z.unknown());

function positiveInteger(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : undefined;
}

function relativeToProject(cwd: string, path: string): string {
  if (isAbsolute(path)) {
    const relativePath = relative(cwd, path);
    return relativePath.startsWith('..') ? path : relativePath;
  }
  return path;
}

function normalizeMessage(raw: unknown, file: string): NormalizedEslintDiagnostic | undefined {
  const parsed = MessageSchema.safeParse(raw);
  if (!parsed.success) {
    return undefined;
  }
  const message = parsed.data;
  // Messages without a ruleId that are not fatal are operational notices
  // ("File ignored because…"), not findings about the code — drop them.
  const ruleId = message.fatal === true ? 'parse-error' : (message.ruleId ?? undefined);
  if (!ruleId) {
    return undefined;
  }
  const startLine = positiveInteger(message.line);
  const startColumn = positiveInteger(message.column);
  const endLine = positiveInteger(message.endLine);
  const endColumn = positiveInteger(message.endColumn);
  return {
    ruleId,
    severity: message.fatal === true || message.severity === 2 ? 'error' : 'warning',
    message: message.message ?? 'ESLint diagnostic',
    file,
    ...(startLine !== undefined ? { startLine } : {}),
    ...(startColumn !== undefined ? { startColumn } : {}),
    ...(endLine !== undefined ? { endLine } : {}),
    ...(endColumn !== undefined ? { endColumn } : {}),
  };
}

export function normalizeEslintOutput(
  input: unknown,
  cwd: string,
): readonly NormalizedEslintDiagnostic[] | undefined {
  if (!Array.isArray(input)) {
    return undefined;
  }
  const diagnostics: NormalizedEslintDiagnostic[] = [];
  for (const rawResult of input) {
    const parsed = ResultSchema.safeParse(rawResult);
    if (!parsed.success) {
      continue;
    }
    const file = relativeToProject(cwd, parsed.data.filePath);
    for (const rawMessage of parsed.data.messages ?? []) {
      const normalized = normalizeMessage(rawMessage, file);
      if (normalized) {
        diagnostics.push(normalized);
      }
    }
  }
  return diagnostics;
}

import { z } from 'zod';

export type NormalizedPlaywrightTest = {
  readonly ruleId: 'playwright-test-failed' | 'playwright-test-flaky';
  readonly severity: 'error' | 'warning';
  readonly file: string;
  readonly line?: number;
  readonly column?: number;
  readonly titlePath: string;
  readonly projectName: string;
  readonly errorMessage: string;
  readonly attachmentPaths: readonly string[];
};

export type NormalizedPlaywrightReport = {
  readonly tests: readonly NormalizedPlaywrightTest[];
  readonly stats: {
    readonly expected: number;
    readonly unexpected: number;
    readonly flaky: number;
    readonly skipped: number;
  };
};

const AttachmentSchema = z
  .object({
    contentType: z.string().optional(),
    path: z.string().optional(),
  })
  .catchall(z.unknown());

const TestResultSchema = z
  .object({
    error: z.object({ message: z.string().optional() }).catchall(z.unknown()).optional(),
    attachments: z.array(AttachmentSchema).optional(),
  })
  .catchall(z.unknown());

const TestSchema = z
  .object({
    projectName: z.string().optional(),
    status: z.string().optional(),
    results: z.array(TestResultSchema).optional(),
  })
  .catchall(z.unknown());

const SpecSchema = z
  .object({
    title: z.string().optional(),
    file: z.string().optional(),
    line: z.number().optional(),
    column: z.number().optional(),
    tests: z.array(TestSchema).optional(),
  })
  .catchall(z.unknown());

// Suites nest recursively; each level is validated on its own so the schema
// stays non-recursive and unknown Playwright fields are tolerated.
const SuiteLevelSchema = z
  .object({
    title: z.string().optional(),
    specs: z.array(z.unknown()).optional(),
    suites: z.array(z.unknown()).optional(),
  })
  .catchall(z.unknown());

const StatsSchema = z
  .object({
    expected: z.number().optional(),
    unexpected: z.number().optional(),
    flaky: z.number().optional(),
    skipped: z.number().optional(),
  })
  .catchall(z.unknown());

const ReportSchema = z
  .object({
    suites: z.array(z.unknown()),
    stats: StatsSchema.optional(),
  })
  .catchall(z.unknown());

// ESC (0x1b) is built with fromCharCode because Biome forbids control
// characters in regex literals.
const ANSI_ESCAPES = new RegExp(`${String.fromCharCode(27)}?\\[[0-9;]*m`, 'g');

function firstErrorLine(message: string | undefined): string {
  if (!message) {
    return '';
  }
  const cleaned = message.replace(ANSI_ESCAPES, '');
  return cleaned.split(/\r?\n/)[0]?.trim() ?? '';
}

function attachmentPaths(results: readonly z.infer<typeof TestResultSchema>[]): readonly string[] {
  const images: string[] = [];
  const others: string[] = [];
  for (const result of results) {
    for (const attachment of result.attachments ?? []) {
      if (!attachment.path) {
        continue;
      }
      if (attachment.contentType?.startsWith('image/')) {
        images.push(attachment.path);
      } else {
        others.push(attachment.path);
      }
    }
  }
  return [...images, ...others];
}

function collectFromSpec(
  spec: z.infer<typeof SpecSchema>,
  titlePrefix: readonly string[],
  sink: NormalizedPlaywrightTest[],
): void {
  const titlePath = [...titlePrefix, spec.title ?? ''].filter(Boolean).join(' > ');
  for (const test of spec.tests ?? []) {
    const ruleId =
      test.status === 'unexpected'
        ? ('playwright-test-failed' as const)
        : test.status === 'flaky'
          ? ('playwright-test-flaky' as const)
          : undefined;
    if (!ruleId || !spec.file) {
      continue;
    }
    const results = test.results ?? [];
    const firstError = results.find((result) => result.error?.message);
    sink.push({
      ruleId,
      severity: ruleId === 'playwright-test-failed' ? 'error' : 'warning',
      file: spec.file,
      ...(spec.line !== undefined ? { line: spec.line } : {}),
      ...(spec.column !== undefined ? { column: spec.column } : {}),
      titlePath,
      projectName: test.projectName ?? '',
      errorMessage: firstErrorLine(firstError?.error?.message),
      attachmentPaths: attachmentPaths(results),
    });
  }
}

function collectFromSuite(
  rawSuite: unknown,
  titlePrefix: readonly string[],
  sink: NormalizedPlaywrightTest[],
): void {
  const suite = SuiteLevelSchema.safeParse(rawSuite);
  if (!suite.success) {
    return;
  }
  const prefix = suite.data.title ? [...titlePrefix, suite.data.title] : titlePrefix;
  for (const rawSpec of suite.data.specs ?? []) {
    const spec = SpecSchema.safeParse(rawSpec);
    if (spec.success) {
      collectFromSpec(spec.data, prefix, sink);
    }
  }
  for (const child of suite.data.suites ?? []) {
    collectFromSuite(child, prefix, sink);
  }
}

export function normalizePlaywrightOutput(input: unknown): NormalizedPlaywrightReport | undefined {
  const report = ReportSchema.safeParse(input);
  if (!report.success) {
    return undefined;
  }
  const tests: NormalizedPlaywrightTest[] = [];
  for (const suite of report.data.suites) {
    collectFromSuite(suite, [], tests);
  }
  return {
    tests,
    stats: {
      expected: report.data.stats?.expected ?? 0,
      unexpected: report.data.stats?.unexpected ?? 0,
      flaky: report.data.stats?.flaky ?? 0,
      skipped: report.data.stats?.skipped ?? 0,
    },
  };
}

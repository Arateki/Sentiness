import { z } from 'zod';

const KnipLocationSchema = z
  .object({
    file: z.string().optional(), // some might not have file if they are top-level
    name: z.string().optional(),
    line: z.number().optional(),
    col: z.number().optional(),
    pos: z.number().optional(),
  })
  .catchall(z.unknown());

const KnipFileIssueSchema = z.union([z.string(), KnipLocationSchema]);

const KnipPerFileGroupSchema = z
  .object({
    file: z.string(),
    files: z.array(KnipFileIssueSchema).optional(),
    dependencies: z.array(KnipFileIssueSchema).optional(),
    devDependencies: z.array(KnipFileIssueSchema).optional(),
    unlisted: z.array(KnipFileIssueSchema).optional(),
    binaries: z.array(KnipFileIssueSchema).optional(),
    unresolved: z.array(KnipFileIssueSchema).optional(),
    exports: z.array(KnipFileIssueSchema).optional(),
    types: z.array(KnipFileIssueSchema).optional(),
    enumMembers: z.array(KnipFileIssueSchema).optional(),
    classMembers: z.array(KnipFileIssueSchema).optional(),
    duplicates: z.array(KnipFileIssueSchema).optional(),
  })
  .catchall(z.unknown());

const KnipOutputSchema = z
  .object({
    // Knip v6 emits per-file issue groups under a top-level `issues` array.
    issues: z.array(KnipPerFileGroupSchema).optional(),
    // Legacy / flat reporters list each category at the top level.
    files: z.array(KnipFileIssueSchema).optional(),
    dependencies: z.array(KnipFileIssueSchema).optional(),
    devDependencies: z.array(KnipFileIssueSchema).optional(),
    unlisted: z.array(KnipFileIssueSchema).optional(),
    binaries: z.array(KnipFileIssueSchema).optional(),
    unresolved: z.array(KnipFileIssueSchema).optional(),
    exports: z.array(KnipFileIssueSchema).optional(),
    types: z.array(KnipFileIssueSchema).optional(),
    enumMembers: z.array(KnipFileIssueSchema).optional(),
    classMembers: z.array(KnipFileIssueSchema).optional(),
    duplicates: z.array(KnipFileIssueSchema).optional(),
  })
  .catchall(z.unknown());

type KnipPerFileGroup = z.infer<typeof KnipPerFileGroupSchema>;
type KnipFlatOutput = z.infer<typeof KnipOutputSchema>;

export type NormalizedKnipIssue = {
  readonly ruleId: string;
  readonly file: string;
  readonly severity: 'error' | 'warning' | 'info';
  readonly message: string;
  readonly name?: string;
  readonly line?: number;
  readonly column?: number;
};

type MaybeKnipIssue = NormalizedKnipIssue | null;

function normalizeIssue(
  ruleId: string,
  severity: 'error' | 'warning' | 'info',
  issue: z.infer<typeof KnipFileIssueSchema>,
  defaultFile: string,
): MaybeKnipIssue {
  if (typeof issue === 'string') {
    if (ruleId !== 'unused-files' && defaultFile === 'unknown') {
      return null;
    }
    return {
      ruleId,
      severity,
      file: ruleId === 'unused-files' ? issue : defaultFile,
      message: ruleId === 'unused-files' ? `Unused file: ${issue}` : `Unused ${ruleId}: ${issue}`,
      name: issue,
    };
  }

  const file = issue.file ?? defaultFile;
  if (file === 'unknown') {
    return null;
  }
  const name = issue.name ?? 'unknown';

  return {
    ruleId,
    severity,
    file,
    message: `Unused ${ruleId}: ${name}`,
    name,
    ...(issue.line !== undefined ? { line: issue.line } : {}),
    ...(issue.col !== undefined ? { column: issue.col } : {}),
  };
}

type CategoryDescriptor = {
  readonly key: keyof KnipPerFileGroup & keyof KnipFlatOutput;
  readonly ruleId: string;
  readonly severity: 'error' | 'warning' | 'info';
  readonly defaultFile: string;
};

const CATEGORIES: readonly CategoryDescriptor[] = [
  { key: 'files', ruleId: 'unused-files', severity: 'warning', defaultFile: 'unknown' },
  {
    key: 'dependencies',
    ruleId: 'unused-dependencies',
    severity: 'error',
    defaultFile: 'package.json',
  },
  {
    key: 'devDependencies',
    ruleId: 'unused-dev-dependencies',
    severity: 'error',
    defaultFile: 'package.json',
  },
  {
    key: 'unlisted',
    ruleId: 'unlisted-dependencies',
    severity: 'error',
    defaultFile: 'package.json',
  },
  { key: 'binaries', ruleId: 'unused-binaries', severity: 'error', defaultFile: 'package.json' },
  {
    key: 'unresolved',
    ruleId: 'unresolved-imports',
    severity: 'error',
    defaultFile: 'package.json',
  },
  { key: 'exports', ruleId: 'unused-exports', severity: 'warning', defaultFile: 'unknown' },
  { key: 'types', ruleId: 'unused-types', severity: 'warning', defaultFile: 'unknown' },
  {
    key: 'enumMembers',
    ruleId: 'unused-enum-members',
    severity: 'warning',
    defaultFile: 'unknown',
  },
  {
    key: 'classMembers',
    ruleId: 'unused-class-members',
    severity: 'warning',
    defaultFile: 'unknown',
  },
  { key: 'duplicates', ruleId: 'duplicates', severity: 'warning', defaultFile: 'unknown' },
];

function collectCategory(
  group: KnipPerFileGroup | KnipFlatOutput,
  descriptor: CategoryDescriptor,
  defaultFile: string,
): MaybeKnipIssue[] {
  const items = (group as Record<string, unknown>)[descriptor.key];
  if (!Array.isArray(items)) {
    return [];
  }
  return items.map((item) =>
    normalizeIssue(
      descriptor.ruleId,
      descriptor.severity,
      item as z.infer<typeof KnipFileIssueSchema>,
      defaultFile,
    ),
  );
}

export function normalizeKnipOutput(output: unknown): NormalizedKnipIssue[] {
  const parsed = KnipOutputSchema.parse(output);
  const issues: MaybeKnipIssue[] = [];

  if (parsed.issues) {
    for (const group of parsed.issues) {
      for (const descriptor of CATEGORIES) {
        // Knip v6 already groups every category by the originating file, so
        // the group's file is always the right default — including for
        // dependency-style rules where the v5 flat format used 'package.json'.
        issues.push(...collectCategory(group, descriptor, group.file));
      }
    }
  }

  for (const descriptor of CATEGORIES) {
    issues.push(...collectCategory(parsed, descriptor, descriptor.defaultFile));
  }

  return issues.filter((issue): issue is NormalizedKnipIssue => issue !== null);
}

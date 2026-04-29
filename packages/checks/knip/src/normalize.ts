import { z } from 'zod';

export type KnipIssue = {
  readonly type: string;
  readonly name: string;
  readonly file: string;
  readonly line?: number;
  readonly col?: number;
  readonly pos?: number;
};

// Knip's JSON reporter usually outputs an object with arrays of issues for different categories.
// Or it outputs an object per file. Let's assume the standard JSON reporter format for Knip v5+.
// Knip v5 JSON format is { files: string[], dependencies: Array<{name: string}>, exports: Array<{name, line, col, pos}>, ... }
// Actually, it usually gives an object keyed by issue type, containing objects keyed by file path.
// Let's define a resilient schema. Knip 5 JSON reporter outputs:
/*
{
  "files": [...],
  "dependencies": [...],
  "unlisted": [...],
  "exports": [...],
  "types": [...],
  ...
}
Each item is an object like: { name: string, ... } and maybe file is top-level or inside.
Wait, let's use a generic array of issues if it's flat, or a known structure.
Actually, let's use the actual Knip JSON structure.
In Knip v5, `--reporter json` outputs:
{
  "files": ["src/unused.ts"],
  "dependencies": [{ "name": "lodash" }],
  "exports": [{ "file": "src/index.ts", "name": "unusedExport", "line": 10, "col": 5 }],
  "types": [{ "file": "src/types.ts", "name": "UnusedType", "line": 2, "col": 1 }]
}
We'll map `files` to file-level findings, `dependencies` to global findings (file: 'package.json'),
and `exports`/`types`/etc to file-level findings.
*/

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

const KnipOutputSchema = z
  .object({
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

export type NormalizedKnipIssue = {
  readonly ruleId: string;
  readonly file: string;
  readonly severity: 'error' | 'warning' | 'info';
  readonly message: string;
  readonly name?: string;
  readonly line?: number;
  readonly column?: number;
};

function normalizeIssue(
  ruleId: string,
  severity: 'error' | 'warning' | 'info',
  issue: z.infer<typeof KnipFileIssueSchema>,
  defaultFile: string,
): NormalizedKnipIssue {
  if (typeof issue === 'string') {
    return {
      ruleId,
      severity,
      file: ruleId === 'unused-files' ? issue : defaultFile,
      message: ruleId === 'unused-files' ? `Unused file: ${issue}` : `Unused ${ruleId}: ${issue}`,
      name: issue,
    };
  }

  const file = issue.file ?? defaultFile;
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

export function normalizeKnipOutput(output: unknown): NormalizedKnipIssue[] {
  const parsed = KnipOutputSchema.parse(output);
  const issues: NormalizedKnipIssue[] = [];

  if (parsed.files) {
    issues.push(
      ...parsed.files.map((i) => normalizeIssue('unused-files', 'warning', i, 'unknown')),
    );
  }
  if (parsed.dependencies) {
    issues.push(
      ...parsed.dependencies.map((i) =>
        normalizeIssue('unused-dependencies', 'error', i, 'package.json'),
      ),
    );
  }
  if (parsed.devDependencies) {
    issues.push(
      ...parsed.devDependencies.map((i) =>
        normalizeIssue('unused-dev-dependencies', 'error', i, 'package.json'),
      ),
    );
  }
  if (parsed.unlisted) {
    issues.push(
      ...parsed.unlisted.map((i) =>
        normalizeIssue('unlisted-dependencies', 'error', i, 'package.json'),
      ),
    );
  }
  if (parsed.binaries) {
    issues.push(
      ...parsed.binaries.map((i) => normalizeIssue('unused-binaries', 'error', i, 'package.json')),
    );
  }
  if (parsed.unresolved) {
    issues.push(
      ...parsed.unresolved.map((i) =>
        normalizeIssue('unresolved-imports', 'error', i, 'package.json'),
      ),
    );
  }
  if (parsed.exports) {
    issues.push(
      ...parsed.exports.map((i) => normalizeIssue('unused-exports', 'warning', i, 'unknown')),
    );
  }
  if (parsed.types) {
    issues.push(
      ...parsed.types.map((i) => normalizeIssue('unused-types', 'warning', i, 'unknown')),
    );
  }
  if (parsed.enumMembers) {
    issues.push(
      ...parsed.enumMembers.map((i) =>
        normalizeIssue('unused-enum-members', 'warning', i, 'unknown'),
      ),
    );
  }
  if (parsed.classMembers) {
    issues.push(
      ...parsed.classMembers.map((i) =>
        normalizeIssue('unused-class-members', 'warning', i, 'unknown'),
      ),
    );
  }
  if (parsed.duplicates) {
    issues.push(
      ...parsed.duplicates.map((i) => normalizeIssue('duplicates', 'warning', i, 'unknown')),
    );
  }

  return issues;
}

import type { NormalizedKnipIssue } from './normalize.js';

/**
 * knip ruleIds that report a dependency (or binary) by name. Only these are
 * subject to the ignore list; file/export/duplicate issues are never filtered.
 */
const DEPENDENCY_RULE_IDS: ReadonlySet<string> = new Set([
  'unused-dependencies',
  'unused-dev-dependencies',
  'unlisted-dependencies',
  'unused-binaries',
]);

/**
 * Dependencies that the Sentiness stack invokes by dynamic dispatch or as a
 * binary — never via a source `import`. knip's import-based heuristics therefore
 * always misreport them as unused once they are installed, producing blocking
 * false-positives on a freshly-onboarded repo. We suppress them by default:
 *
 * - the `@sentiness/*` scope: check packages are loaded by the CLI registry, and
 *   `@sentiness/core` is the CLI binary itself;
 * - the external tool binaries each Sentiness check wraps (run via `execFile`).
 *
 * Patterns are matched as anchored regular expressions against the dependency
 * name (so `@sentiness/.*` matches every scoped package while `eslint` matches
 * only `eslint`). Users can extend this set through `knip.ignoreDependencies` in
 * `sentiness.config.json`.
 */
export const DEFAULT_IGNORED_DEPENDENCIES: readonly string[] = [
  '@sentiness/.*',
  'eslint',
  'biome',
  '@biomejs/biome',
  'knip',
  'playwright',
  '@playwright/test',
  'jscpd',
  'semgrep',
  'osv-scanner',
  'dependency-cruiser',
  'lockfile-lint',
  '@stryker-mutator/core',
];

function matchesPattern(name: string, pattern: string): boolean {
  try {
    return new RegExp(`^(?:${pattern})$`).test(name);
  } catch {
    // A user-supplied pattern that is not valid regex falls back to an exact
    // literal match rather than crashing the check.
    return name === pattern;
  }
}

/**
 * True when `issue` is a dependency/binary finding whose name matches any of the
 * supplied ignore patterns. Non-dependency findings are never ignored.
 */
export function isIgnoredDependencyIssue(
  issue: NormalizedKnipIssue,
  patterns: readonly string[],
): boolean {
  if (!DEPENDENCY_RULE_IDS.has(issue.ruleId)) {
    return false;
  }
  const name = issue.name;
  if (!name) {
    return false;
  }
  return patterns.some((pattern) => matchesPattern(name, pattern));
}

/**
 * Drops dependency findings that match the default Sentiness ignore list merged
 * with any extra user-supplied patterns. Order and identity of surviving issues
 * are preserved.
 */
export function filterIgnoredDependencies(
  issues: readonly NormalizedKnipIssue[],
  extraPatterns: readonly string[] = [],
): NormalizedKnipIssue[] {
  const patterns = [...DEFAULT_IGNORED_DEPENDENCIES, ...extraPatterns];
  return issues.filter((issue) => !isIgnoredDependencyIssue(issue, patterns));
}

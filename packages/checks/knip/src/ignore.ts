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
 * The `@sentiness/*` scope: check packages are loaded by the CLI registry and
 * `@sentiness/core` is the CLI binary itself, so they are never `import`ed from
 * a target project's source.
 */
export const SENTINESS_SCOPE_PATTERN = '@sentiness/.*';

/**
 * External tool dependency each Sentiness check wraps and runs via `execFile`,
 * keyed by check id. knip's import-based analysis cannot see binary usage, so it
 * misreports these as unused once installed. Checks without an npm-installable
 * tool (`coverage`, `deps-diff`) are intentionally absent.
 */
export const CHECK_TOOL_DEPENDENCIES: Readonly<Record<string, readonly string[]>> = {
  biome: ['biome', '@biomejs/biome'],
  eslint: ['eslint'],
  knip: ['knip'],
  playwright: ['playwright', '@playwright/test'],
  jscpd: ['jscpd'],
  semgrep: ['semgrep'],
  'osv-scanner': ['osv-scanner'],
  'dependency-cruiser': ['dependency-cruiser'],
  'lockfile-lint': ['lockfile-lint'],
  stryker: ['@stryker-mutator/core'],
};

/**
 * Dependency names/patterns ignored at runtime by default (issue #7). Covers the
 * `@sentiness/*` scope plus every wrapped tool binary, because at runtime the
 * check does not know which sibling checks are enabled. Matched as anchored
 * regular expressions against the dependency name (so `@sentiness/.*` matches
 * every scoped package while `eslint` matches only `eslint`). Users can extend
 * this set through `knip.ignoreDependencies` in `sentiness.config.json`.
 */
export const DEFAULT_IGNORED_DEPENDENCIES: readonly string[] = [
  SENTINESS_SCOPE_PATTERN,
  ...Object.values(CHECK_TOOL_DEPENDENCIES).flat(),
];

/**
 * Scope + the wrapped tool binaries of the *given* checks, deduplicated and
 * stably ordered. Used by `defaultConfig` to scaffold a minimal `knip.json`
 * `ignoreDependencies` list that reflects only the enabled checks, rather than
 * the fixed superset used at runtime.
 */
export function ignoredDependenciesForChecks(checkIds: readonly string[]): readonly string[] {
  const tools = new Set<string>();
  for (const id of checkIds) {
    for (const dep of CHECK_TOOL_DEPENDENCIES[id] ?? []) {
      tools.add(dep);
    }
  }
  return [SENTINESS_SCOPE_PATTERN, ...tools];
}

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

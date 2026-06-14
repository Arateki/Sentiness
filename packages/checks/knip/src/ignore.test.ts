import { describe, expect, it } from 'vitest';
import {
  CHECK_TOOL_DEPENDENCIES,
  DEFAULT_IGNORED_DEPENDENCIES,
  filterIgnoredDependencies,
  ignoredDependenciesForChecks,
  isIgnoredDependencyIssue,
  SENTINESS_SCOPE_PATTERN,
} from './ignore.js';
import type { NormalizedKnipIssue } from './normalize.js';

function depIssue(name: string, ruleId = 'unused-dev-dependencies'): NormalizedKnipIssue {
  return {
    ruleId,
    severity: 'error',
    file: 'package.json',
    message: `Unused ${ruleId}: ${name}`,
    name,
  };
}

describe('isIgnoredDependencyIssue', () => {
  it('ignores the @sentiness scope by default', () => {
    expect(
      isIgnoredDependencyIssue(depIssue('@sentiness/check-biome'), DEFAULT_IGNORED_DEPENDENCIES),
    ).toBe(true);
    expect(
      isIgnoredDependencyIssue(depIssue('@sentiness/core'), DEFAULT_IGNORED_DEPENDENCIES),
    ).toBe(true);
  });

  it('ignores the wrapped tool binaries by default', () => {
    for (const tool of ['eslint', '@biomejs/biome', 'knip', '@playwright/test', 'semgrep']) {
      expect(isIgnoredDependencyIssue(depIssue(tool), DEFAULT_IGNORED_DEPENDENCIES)).toBe(true);
    }
  });

  it('anchors patterns so it does not over-match similar names', () => {
    expect(
      isIgnoredDependencyIssue(depIssue('eslint-plugin-vue'), DEFAULT_IGNORED_DEPENDENCIES),
    ).toBe(false);
    expect(
      isIgnoredDependencyIssue(depIssue('@sentiness-fork/x'), DEFAULT_IGNORED_DEPENDENCIES),
    ).toBe(false);
  });

  it('only applies to dependency-style rules', () => {
    const fileIssue: NormalizedKnipIssue = {
      ruleId: 'unused-files',
      severity: 'warning',
      file: 'src/dead.ts',
      message: 'Unused file: src/dead.ts',
      name: 'eslint',
    };
    expect(isIgnoredDependencyIssue(fileIssue, DEFAULT_IGNORED_DEPENDENCIES)).toBe(false);
  });

  it('covers all dependency-family rule ids', () => {
    for (const ruleId of [
      'unused-dependencies',
      'unused-dev-dependencies',
      'unlisted-dependencies',
      'unused-binaries',
    ]) {
      expect(
        isIgnoredDependencyIssue(
          depIssue('@sentiness/check-knip', ruleId),
          DEFAULT_IGNORED_DEPENDENCIES,
        ),
      ).toBe(true);
    }
  });

  it('honors extra user patterns', () => {
    expect(isIgnoredDependencyIssue(depIssue('multer'), DEFAULT_IGNORED_DEPENDENCIES)).toBe(false);
    expect(
      isIgnoredDependencyIssue(depIssue('multer'), [...DEFAULT_IGNORED_DEPENDENCIES, 'multer']),
    ).toBe(true);
  });

  it('falls back to literal match on invalid regex patterns', () => {
    expect(isIgnoredDependencyIssue(depIssue('('), ['('])).toBe(true);
    expect(isIgnoredDependencyIssue(depIssue('other'), ['('])).toBe(false);
  });

  it('does not match when the issue has no name', () => {
    const noName: NormalizedKnipIssue = {
      ruleId: 'unused-dev-dependencies',
      severity: 'error',
      file: 'package.json',
      message: 'Unused',
    };
    expect(isIgnoredDependencyIssue(noName, DEFAULT_IGNORED_DEPENDENCIES)).toBe(false);
  });
});

describe('filterIgnoredDependencies', () => {
  it('drops the Sentiness false-positives but keeps real findings', () => {
    const issues: NormalizedKnipIssue[] = [
      depIssue('@sentiness/check-biome'),
      depIssue('@sentiness/check-eslint'),
      depIssue('eslint'),
      depIssue('vuetify'),
      depIssue('left-pad', 'unused-dependencies'),
    ];
    const result = filterIgnoredDependencies(issues);
    expect(result.map((i) => i.name)).toEqual(['vuetify', 'left-pad']);
  });

  it('keeps non-dependency findings untouched', () => {
    const fileIssue: NormalizedKnipIssue = {
      ruleId: 'unused-files',
      severity: 'warning',
      file: 'src/dead.ts',
      message: 'Unused file: src/dead.ts',
      name: 'src/dead.ts',
    };
    expect(filterIgnoredDependencies([fileIssue])).toEqual([fileIssue]);
  });

  it('applies extra patterns from config', () => {
    const issues = [depIssue('vuetify'), depIssue('sass')];
    expect(filterIgnoredDependencies(issues, ['vuetify', 'sass'])).toEqual([]);
  });
});

describe('ignoredDependenciesForChecks', () => {
  it('returns only the scope when no check wraps a tool', () => {
    expect(ignoredDependenciesForChecks(['coverage', 'deps-diff'])).toEqual([
      SENTINESS_SCOPE_PATTERN,
    ]);
  });

  it('includes the tools of the given checks, deduplicated', () => {
    expect(ignoredDependenciesForChecks(['eslint', 'biome', 'eslint'])).toEqual([
      SENTINESS_SCOPE_PATTERN,
      'eslint',
      'biome',
      '@biomejs/biome',
    ]);
  });

  it('ignores unknown check ids', () => {
    expect(ignoredDependenciesForChecks(['does-not-exist'])).toEqual([SENTINESS_SCOPE_PATTERN]);
  });

  it('keeps the runtime default list in sync with the tool map', () => {
    expect(DEFAULT_IGNORED_DEPENDENCIES).toEqual([
      SENTINESS_SCOPE_PATTERN,
      ...Object.values(CHECK_TOOL_DEPENDENCIES).flat(),
    ]);
  });
});

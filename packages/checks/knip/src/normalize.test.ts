import { describe, expect, it } from 'vitest';
import { normalizeKnipOutput } from './normalize.js';

describe('normalizeKnipOutput', () => {
  it('handles empty or missing keys', () => {
    expect(normalizeKnipOutput({})).toEqual([]);
    expect(normalizeKnipOutput({ files: [] })).toEqual([]);
  });

  it('normalizes unused files', () => {
    const issues = normalizeKnipOutput({
      files: ['src/unused.ts'],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toEqual({
      ruleId: 'unused-files',
      severity: 'warning',
      file: 'src/unused.ts',
      message: 'Unused file: src/unused.ts',
      name: 'src/unused.ts',
    });
  });

  it('normalizes unused dependencies as global errors', () => {
    const issues = normalizeKnipOutput({
      dependencies: [{ name: 'lodash' }],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toEqual({
      ruleId: 'unused-dependencies',
      severity: 'error',
      file: 'package.json',
      message: 'Unused unused-dependencies: lodash',
      name: 'lodash',
      line: undefined,
      column: undefined,
    });
  });

  it('normalizes unused exports with location', () => {
    const issues = normalizeKnipOutput({
      exports: [{ file: 'src/index.ts', name: 'foo', line: 10, col: 5 }],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toEqual({
      ruleId: 'unused-exports',
      severity: 'warning',
      file: 'src/index.ts',
      message: 'Unused unused-exports: foo',
      name: 'foo',
      line: 10,
      column: 5,
    });
  });

  it('normalizes all other issue types', () => {
    const issues = normalizeKnipOutput({
      devDependencies: [{ name: 'jest' }],
      unlisted: [{ name: 'chalk' }],
      binaries: [{ name: 'tsc' }],
      unresolved: [{ name: 'crypto' }],
      types: [{ file: 'types.ts', name: 'MyType' }],
      enumMembers: [{ file: 'enums.ts', name: 'MyEnum' }],
      classMembers: [{ file: 'class.ts', name: 'MyClass' }],
      duplicates: [{ file: 'dup.ts', name: 'Duplicate' }],
      exports: ['justAString'], // test string fallback
    });

    expect(issues).toHaveLength(8);
    expect(issues.find((i) => i.ruleId === 'unused-dev-dependencies')).toBeDefined();
    expect(issues.find((i) => i.ruleId === 'unlisted-dependencies')).toBeDefined();
    expect(issues.find((i) => i.ruleId === 'unused-binaries')).toBeDefined();
    expect(issues.find((i) => i.ruleId === 'unresolved-imports')).toBeDefined();
    expect(issues.find((i) => i.ruleId === 'unused-types')).toBeDefined();
    expect(issues.find((i) => i.ruleId === 'unused-enum-members')).toBeDefined();
    expect(issues.find((i) => i.ruleId === 'unused-class-members')).toBeDefined();
    expect(issues.find((i) => i.ruleId === 'duplicates')).toBeDefined();

    expect(issues.find((i) => i.name === 'justAString')).toBeUndefined();
  });

  it('handles Knip v6 per-file issues array with file as default location', () => {
    const issues = normalizeKnipOutput({
      issues: [
        {
          file: 'packages/example/package.json',
          devDependencies: [{ name: 'jest', line: 21, col: 6 }],
        },
        {
          file: 'src/unused.ts',
          files: [{ name: 'src/unused.ts' }],
        },
        {
          file: 'src/api.ts',
          exports: [{ name: 'unusedFn', line: 7, col: 14 }],
          types: [{ name: 'UnusedType', line: 12, col: 18 }],
        },
      ],
    });

    const byRule = new Map(issues.map((issue) => [issue.ruleId, issue]));
    expect(byRule.get('unused-dev-dependencies')).toMatchObject({
      file: 'packages/example/package.json',
      name: 'jest',
      line: 21,
      column: 6,
    });
    expect(byRule.get('unused-files')).toMatchObject({
      file: 'src/unused.ts',
      name: 'src/unused.ts',
    });
    expect(byRule.get('unused-exports')).toMatchObject({
      file: 'src/api.ts',
      name: 'unusedFn',
      line: 7,
      column: 14,
    });
    expect(byRule.get('unused-types')).toMatchObject({
      file: 'src/api.ts',
      name: 'UnusedType',
    });
  });
});

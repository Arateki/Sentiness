import { describe, expect, it } from 'vitest';
import { normalizeEslintOutput } from './normalize.js';

function result(filePath: string, messages: readonly unknown[]): Record<string, unknown> {
  return {
    filePath,
    messages,
    suppressedMessages: [],
    errorCount: 0,
    fatalErrorCount: 0,
    warningCount: 0,
    fixableErrorCount: 0,
    fixableWarningCount: 0,
    usedDeprecatedRules: [],
  };
}

describe('normalizeEslintOutput', () => {
  it('normalizes diagnostics and relativizes absolute paths against the project root', () => {
    const diagnostics = normalizeEslintOutput(
      [
        result('/project/apps/web/src/App.vue', [
          {
            ruleId: 'vue/require-v-for-key',
            severity: 2,
            message: "Elements in iteration expect to have 'v-bind:key' directives.",
            line: 12,
            column: 5,
            nodeType: 'VStartTag',
            endLine: 12,
            endColumn: 30,
          },
        ]),
        result('/project/src/util.ts', [
          {
            ruleId: 'no-unused-vars',
            severity: 1,
            message: "'value' is defined but never used.",
            line: 3,
            column: 7,
          },
        ]),
      ],
      '/project',
    );

    expect(diagnostics).toEqual([
      {
        ruleId: 'vue/require-v-for-key',
        severity: 'error',
        message: "Elements in iteration expect to have 'v-bind:key' directives.",
        file: 'apps/web/src/App.vue',
        startLine: 12,
        startColumn: 5,
        endLine: 12,
        endColumn: 30,
      },
      {
        ruleId: 'no-unused-vars',
        severity: 'warning',
        message: "'value' is defined but never used.",
        file: 'src/util.ts',
        startLine: 3,
        startColumn: 7,
      },
    ]);
  });

  it('maps fatal messages to the parse-error rule with error severity', () => {
    const diagnostics = normalizeEslintOutput(
      [
        result('/project/src/broken.ts', [
          {
            ruleId: null,
            fatal: true,
            severity: 2,
            message: 'Parsing error: Unexpected token }',
            line: 7,
            column: 1,
          },
        ]),
      ],
      '/project',
    );

    expect(diagnostics).toEqual([
      {
        ruleId: 'parse-error',
        severity: 'error',
        message: 'Parsing error: Unexpected token }',
        file: 'src/broken.ts',
        startLine: 7,
        startColumn: 1,
      },
    ]);
  });

  it('drops non-fatal messages without a ruleId (operational notices)', () => {
    const diagnostics = normalizeEslintOutput(
      [
        result('/project/dist/bundle.js', [
          {
            ruleId: null,
            fatal: false,
            severity: 1,
            message:
              'File ignored because of a matching ignore pattern. Use "--no-ignore" to disable file ignore settings or use "--no-warn-ignored" to suppress this warning.',
          },
        ]),
      ],
      '/project',
    );

    expect(diagnostics).toEqual([]);
  });

  it('keeps paths outside the project root absolute', () => {
    const diagnostics = normalizeEslintOutput(
      [
        result('/elsewhere/file.ts', [
          { ruleId: 'no-debugger', severity: 2, message: 'Unexpected debugger.', line: 1 },
        ]),
      ],
      '/project',
    );

    expect(diagnostics[0]?.file).toBe('/elsewhere/file.ts');
  });

  it('returns undefined when the output is not an array', () => {
    expect(normalizeEslintOutput({ results: [] }, '/project')).toBeUndefined();
    expect(normalizeEslintOutput('oops', '/project')).toBeUndefined();
  });

  it('skips malformed result entries and unknown severities default to warning', () => {
    const diagnostics = normalizeEslintOutput(
      [
        42,
        { messages: [{ ruleId: 'x', severity: 2, message: 'no filePath' }] },
        result('/project/src/a.ts', [
          { ruleId: 'eqeqeq', severity: 9, message: "Expected '===' and instead saw '=='." },
        ]),
      ],
      '/project',
    );

    expect(diagnostics).toEqual([
      {
        ruleId: 'eqeqeq',
        severity: 'warning',
        message: "Expected '===' and instead saw '=='.",
        file: 'src/a.ts',
      },
    ]);
  });
});

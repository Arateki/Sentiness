import { describe, expect, it } from 'vitest';
import { jscpdMetrics, normalizeJscpdOutput } from './normalize.js';

describe('normalizeJscpdOutput', () => {
  it('normalizes duplicate blocks and metrics', () => {
    const output = {
      duplicates: [
        {
          firstFile: {
            name: 'src/a.ts',
            start: { line: 3, column: 1 },
            end: { line: 8, column: 2 },
          },
          secondFile: { name: 'src/b.ts' },
          lines: 6,
          tokens: 30,
          fragment: 'duplicated();',
        },
      ],
      statistics: { total: { lines: 6, tokens: 30, percentage: 4.5 } },
    };

    expect(normalizeJscpdOutput(output)).toEqual([
      {
        ruleId: 'duplicated-code',
        severity: 'warning',
        message: 'Duplicated code between src/a.ts and src/b.ts (6 lines)',
        file: 'src/a.ts',
        startLine: 3,
        startColumn: 1,
        endLine: 8,
        endColumn: 2,
        pairedFile: 'src/b.ts',
        lines: 6,
        tokens: 30,
        snippet: 'duplicated();',
      },
    ]);
    expect(jscpdMetrics(output)).toEqual({
      duplicatedLines: 6,
      duplicatedTokens: 30,
      duplicationPercentage: 4.5,
    });
  });
});

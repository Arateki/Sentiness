import { describe, expect, it } from 'vitest';
import { normalizeBiomeOutput } from './normalize.js';

describe('normalizeBiomeOutput', () => {
  it('normalizes flexible biome diagnostics', () => {
    const diagnostics = normalizeBiomeOutput({
      diagnostics: [
        {
          category: 'lint/style/useConst',
          severity: 'warning',
          message: 'Use const',
          location: { path: { file: 'src/index.ts' }, start: { line: 2, column: 5 } },
        },
      ],
    });

    expect(diagnostics).toEqual([
      {
        ruleId: 'lint/style/useConst',
        severity: 'warning',
        message: 'Use const',
        file: 'src/index.ts',
        startLine: 2,
        startColumn: 5,
      },
    ]);
  });
});

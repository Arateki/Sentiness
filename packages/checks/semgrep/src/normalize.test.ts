import { describe, expect, it } from 'vitest';
import { normalizeSemgrepOutput } from './normalize.js';

describe('normalizeSemgrepOutput', () => {
  it('normalizes Semgrep JSON results', () => {
    const findings = normalizeSemgrepOutput({
      results: [
        {
          check_id: 'javascript.lang.security.detect-eval',
          path: 'src/a.ts',
          start: { line: 5, col: 3 },
          end: { line: 5, col: 12 },
          extra: {
            message: 'Avoid eval',
            severity: 'ERROR',
            fingerprint: 'abc',
            metadata: { references: ['https://example.test/rule'] },
          },
        },
      ],
    });

    expect(findings).toEqual([
      {
        ruleId: 'javascript.lang.security.detect-eval',
        severity: 'error',
        message: 'Avoid eval',
        file: 'src/a.ts',
        startLine: 5,
        startColumn: 3,
        endLine: 5,
        endColumn: 12,
        fingerprintHint: 'abc',
        references: ['https://example.test/rule'],
      },
    ]);
  });
});

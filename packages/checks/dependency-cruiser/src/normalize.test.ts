import { describe, expect, it } from 'vitest';
import { normalizeDependencyCruiserOutput } from './normalize.js';

describe('normalizeDependencyCruiserOutput', () => {
  it('normalizes summary and dependency-level violations', () => {
    const output = normalizeDependencyCruiserOutput({
      summary: {
        violations: [
          {
            from: 'src/a.ts',
            to: 'src/b.ts',
            rule: { name: 'no-circular', severity: 'error', comment: 'cycle' },
            lineNumber: 4,
          },
        ],
      },
      modules: [
        {
          source: 'src/c.ts',
          dependencies: [
            {
              resolved: 'src/d.ts',
              lineNumber: 7,
              rules: [{ name: 'no-orphans', severity: 'warn' }],
            },
          ],
        },
      ],
    });

    expect(output).toEqual([
      {
        ruleId: 'no-circular',
        severity: 'error',
        message: 'cycle',
        from: 'src/a.ts',
        to: 'src/b.ts',
        startLine: 4,
      },
      {
        ruleId: 'no-orphans',
        severity: 'warning',
        message: 'Dependency-cruiser rule "no-orphans" failed for src/c.ts -> src/d.ts',
        from: 'src/c.ts',
        to: 'src/d.ts',
        startLine: 7,
      },
    ]);
  });
});

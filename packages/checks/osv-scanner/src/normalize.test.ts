import { describe, expect, it } from 'vitest';
import { normalizeOsvOutput } from './normalize.js';

describe('normalizeOsvOutput', () => {
  it('normalizes package vulnerabilities with severity and fixed versions', () => {
    const findings = normalizeOsvOutput({
      results: [
        {
          packages: [
            {
              package: { name: 'lodash', version: '4.17.20' },
              vulnerabilities: [
                {
                  id: 'GHSA-test',
                  summary: 'Prototype pollution',
                  database_specific: { severity: 'HIGH' },
                  affected: [{ ranges: [{ events: [{ fixed: '4.17.21' }] }] }],
                  references: [{ url: 'https://example.test/advisory' }],
                },
              ],
            },
          ],
        },
      ],
    });

    expect(findings).toEqual([
      {
        id: 'GHSA-test',
        severity: 'error',
        message: 'Prototype pollution',
        packageName: 'lodash',
        packageVersion: '4.17.20',
        fixedVersion: '4.17.21',
        references: ['https://osv.dev/GHSA-test', 'https://example.test/advisory'],
      },
    ]);
  });
});

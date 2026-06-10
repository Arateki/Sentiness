import { describe, expect, it } from 'vitest';
import { type NormalizedPlaywrightReport, normalizePlaywrightOutput } from './normalize.js';

const REPORT = {
  config: { rootDir: '/project/e2e' },
  suites: [
    {
      title: 'login.spec.ts',
      file: 'login.spec.ts',
      specs: [
        {
          title: 'shows an error for bad credentials',
          file: 'login.spec.ts',
          line: 12,
          column: 5,
          tests: [
            {
              projectName: 'chromium',
              status: 'unexpected',
              results: [
                {
                  status: 'failed',
                  error: {
                    message: '\u001b[31mexpect(locator).toBeVisible()\u001b[39m\n\nCall log:',
                  },
                  attachments: [
                    {
                      name: 'screenshot',
                      contentType: 'image/png',
                      path: '/project/test-results/login-bad-creds-chromium/test-failed-1.png',
                    },
                    {
                      name: 'trace',
                      contentType: 'application/zip',
                      path: '/project/test-results/login-bad-creds-chromium/trace.zip',
                    },
                  ],
                },
              ],
            },
            {
              projectName: 'firefox',
              status: 'expected',
              results: [{ status: 'passed' }],
            },
          ],
        },
      ],
      suites: [
        {
          title: 'remember me',
          specs: [
            {
              title: 'persists the session',
              file: 'login.spec.ts',
              line: 40,
              column: 3,
              tests: [
                {
                  projectName: 'chromium',
                  status: 'flaky',
                  results: [
                    { status: 'failed', error: { message: 'Timed out waiting for cookie' } },
                    { status: 'passed' },
                  ],
                },
              ],
            },
            {
              title: 'skipped on CI',
              file: 'login.spec.ts',
              line: 55,
              column: 3,
              tests: [{ projectName: 'chromium', status: 'skipped', results: [] }],
            },
          ],
        },
      ],
    },
  ],
  stats: { expected: 1, unexpected: 1, flaky: 1, skipped: 1 },
};

describe('normalizePlaywrightOutput', () => {
  it('maps unexpected and flaky tests across nested suites', () => {
    const normalized: NormalizedPlaywrightReport | undefined = normalizePlaywrightOutput(REPORT);

    expect(normalized?.tests).toHaveLength(2);
    const failed = normalized?.tests.find((test) => test.ruleId === 'playwright-test-failed');
    const flaky = normalized?.tests.find((test) => test.ruleId === 'playwright-test-flaky');

    expect(failed).toMatchObject({
      severity: 'error',
      file: 'login.spec.ts',
      line: 12,
      projectName: 'chromium',
      titlePath: 'login.spec.ts > shows an error for bad credentials',
    });
    expect(flaky).toMatchObject({
      severity: 'warning',
      line: 40,
      titlePath: 'login.spec.ts > remember me > persists the session',
    });
  });

  it('strips ANSI escapes and keeps only the first error line', () => {
    const normalized = normalizePlaywrightOutput(REPORT);
    const failed = normalized?.tests.find((test) => test.ruleId === 'playwright-test-failed');

    expect(failed?.errorMessage).toBe('expect(locator).toBeVisible()');
  });

  it('orders attachment paths with images before traces', () => {
    const normalized = normalizePlaywrightOutput(REPORT);
    const failed = normalized?.tests.find((test) => test.ruleId === 'playwright-test-failed');

    expect(failed?.attachmentPaths).toEqual([
      '/project/test-results/login-bad-creds-chromium/test-failed-1.png',
      '/project/test-results/login-bad-creds-chromium/trace.zip',
    ]);
  });

  it('exposes report stats', () => {
    const normalized = normalizePlaywrightOutput(REPORT);

    expect(normalized?.stats).toEqual({ expected: 1, unexpected: 1, flaky: 1, skipped: 1 });
  });

  it('returns undefined for output that is not a Playwright report', () => {
    expect(normalizePlaywrightOutput('nope')).toBeUndefined();
    expect(normalizePlaywrightOutput({})).toBeUndefined();
    expect(normalizePlaywrightOutput(null)).toBeUndefined();
  });

  it('tolerates malformed suites, specs without files, and bare results', () => {
    const normalized = normalizePlaywrightOutput({
      suites: [
        'not a suite',
        {
          specs: [
            42,
            {
              title: 'no file so it is dropped',
              line: 1,
              tests: [{ status: 'unexpected', results: [] }],
            },
            {
              title: 'flaky without error or attachments',
              file: 'a.spec.ts',
              tests: [
                {
                  status: 'flaky',
                  results: [{ attachments: [{ name: 'stdout', contentType: 'text/plain' }] }],
                },
              ],
            },
          ],
        },
      ],
    });

    expect(normalized?.tests).toHaveLength(1);
    expect(normalized?.tests[0]).toMatchObject({
      ruleId: 'playwright-test-flaky',
      file: 'a.spec.ts',
      projectName: '',
      errorMessage: '',
      attachmentPaths: [],
    });
    expect(normalized?.tests[0]?.line).toBeUndefined();
    expect(normalized?.stats).toEqual({ expected: 0, unexpected: 0, flaky: 0, skipped: 0 });
  });
});

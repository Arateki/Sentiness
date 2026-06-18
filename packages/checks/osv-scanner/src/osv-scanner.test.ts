import { FakeProcessRunner, InMemoryFileSystem, SilentLogger } from '@sentiness/_test-utils';
import type { CheckContext } from '@sentiness/check-sdk';
import { describe, expect, it } from 'vitest';
import { osvScannerCheck } from './osv-scanner.js';

function context(process: FakeProcessRunner, fs: InMemoryFileSystem): CheckContext {
  return {
    cwd: '/project',
    repoRoot: '/project',
    tier: 'slow',
    trigger: null,
    baseRef: null,
    changedFiles: [],
    changedRanges: new Map(),
    diffOnly: false,
    signal: new AbortController().signal,
    logger: new SilentLogger(),
    fs,
    process,
    checkConfig: { enabled: true },
  };
}

describe('osvScannerCheck', () => {
  it('detects osv-scanner availability when a supported lockfile exists', async () => {
    const process = new FakeProcessRunner();
    process.enqueue({ exitCode: 0, stdout: 'osv-scanner version 2.0.0\n', stderr: '' });

    const detect = await osvScannerCheck.detect(
      context(process, new InMemoryFileSystem({ '/project/pnpm-lock.yaml': '' })),
    );

    expect(detect).toEqual({ available: true, version: 'osv-scanner version 2.0.0' });
  });

  it('runs once per lockfile and maps vulnerabilities', async () => {
    const process = new FakeProcessRunner();
    process.enqueue({
      exitCode: 1,
      stdout: JSON.stringify({
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
                  },
                ],
              },
            ],
          },
        ],
      }),
      stderr: '',
    });

    const result = await osvScannerCheck.run(
      context(process, new InMemoryFileSystem({ '/project/package-lock.json': '{}' })),
    );

    expect(result.status).toBe('violations');
    expect(process.calls[0]?.args).toEqual(['scan', '--format', 'json', '-L', 'package-lock.json']);
    expect(result.findings[0]?.location).toMatchObject({
      file: 'package-lock.json',
      packageName: 'lodash',
      packageVersion: '4.17.20',
    });
    expect(result.findings[0]?.suggestion?.command).toBe('npm install lodash@4.17.21');
    expect(result.findings[0]?.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it('returns an error for scanner execution failures', async () => {
    const process = new FakeProcessRunner();
    process.enqueue({ exitCode: 2, stdout: '', stderr: 'bad config' });

    const result = await osvScannerCheck.run(
      context(process, new InMemoryFileSystem({ '/project/yarn.lock': '' })),
    );

    expect(result.status).toBe('error');
    expect(result.errorMessage).toBe('bad config');
  });
});

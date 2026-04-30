import {
  FakeProcessRunner,
  InMemoryFileSystem,
  InMemoryGitProvider,
  SilentLogger,
} from '@sentiness/_test-utils';
import type { CheckContext } from '@sentiness/check-sdk';
import { describe, expect, it } from 'vitest';
import { depsDiffCheck } from './deps-diff.js';

function context(fs: InMemoryFileSystem, git?: InMemoryGitProvider): CheckContext {
  return {
    cwd: '/project',
    tier: 'fast',
    trigger: null,
    baseRef: 'main',
    changedFiles: [],
    diffOnly: false,
    signal: new AbortController().signal,
    logger: new SilentLogger(),
    fs,
    ...(git ? { git } : {}),
    process: new FakeProcessRunner(),
    checkConfig: { enabled: true },
  };
}

describe('depsDiffCheck', () => {
  it('detects package.json availability', async () => {
    const fs = new InMemoryFileSystem({ '/project/package.json': '{}' });
    await expect(depsDiffCheck.detect(context(fs))).resolves.toEqual({ available: true });
  });

  it('reports added, removed, and major-bumped direct dependencies', async () => {
    const fs = new InMemoryFileSystem({
      '/project/package.json': JSON.stringify(
        {
          dependencies: { react: '^19.0.0', zod: '^4.0.0' },
          devDependencies: { vitest: '^3.0.0' },
        },
        null,
        2,
      ),
    });
    const git = new InMemoryGitProvider();
    git.files.set(
      'main:package.json',
      JSON.stringify(
        {
          dependencies: { react: '^18.0.0', lodash: '^4.0.0' },
          devDependencies: { vitest: '^3.0.0' },
        },
        null,
        2,
      ),
    );

    const result = await depsDiffCheck.run(context(fs, git));

    expect(result.status).toBe('violations');
    expect(result.metrics?.transitiveDiffAvailable).toBe(false);
    expect(result.findings.map((finding) => finding.ruleId).sort()).toEqual([
      'major-version-bump',
      'new-dependency',
      'removed-dependency',
    ]);
    expect(
      result.findings.find((finding) => finding.ruleId === 'new-dependency')?.location,
    ).toMatchObject({
      file: 'package.json',
      packageName: 'zod',
      packageVersion: '^4.0.0',
    });
    expect(result.findings.every((finding) => /^[a-f0-9]{64}$/.test(finding.fingerprint))).toBe(
      true,
    );
  });

  it('returns an error when the Git provider is missing', async () => {
    const fs = new InMemoryFileSystem({ '/project/package.json': '{}' });

    const result = await depsDiffCheck.run(context(fs));

    expect(result.status).toBe('error');
    expect(result.errorMessage).toContain('Git provider');
  });
});

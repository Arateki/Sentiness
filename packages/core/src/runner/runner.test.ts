import { FixedClock, InMemoryFileSystem, InMemoryGitProvider } from '@sentiness/_test-utils';
import { asCheckId, type Check } from '@sentiness/check-sdk';
import { describe, expect, it, vi } from 'vitest';
import type { ArtifactStore } from '../cache/artifact-store.js';
import { DEFAULT_CONFIG, type ResolvedConfig } from '../config/config.js';
import type { SentinessLock } from '../lock/schema.js';
import { CheckRegistry } from '../registry/registry.js';
import { runChecks } from './runner.js';

const emptyLock: SentinessLock = { lockfileVersion: 1, engine: { version: '2.0.0' }, checks: {} };
const stubStore: ArtifactStore = {
  slotPath: () => '/unused',
  isMaterialized: async () => false,
  materialize: async () => ({ path: '/unused', integrity: '' }),
};
function makeRegistry(config: ResolvedConfig = DEFAULT_CONFIG): Promise<CheckRegistry> {
  return CheckRegistry.fromResolved(config, emptyLock, stubStore, process.cwd());
}

describe('runner', () => {
  it('throws on trigger and tier mismatch', async () => {
    const registry = await makeRegistry();
    const fs = new InMemoryFileSystem();
    const git = new InMemoryGitProvider();

    await expect(
      runChecks(
        {
          registry,
          config: DEFAULT_CONFIG,
          cwd: '/project',
          fs,
          git,
          process: {} as unknown as import('@sentiness/check-sdk').ProcessRunner,
          logger: {} as unknown as import('@sentiness/check-sdk').Logger,
          clock: new FixedClock(0),
        },
        { tier: 'slow', trigger: 'post-edit', diffOnly: false },
      ),
    ).rejects.toThrow(/Trigger "post-edit" belongs to "fast", not "slow"/);
  });

  it('runs successfully with empty registry', async () => {
    const registry = await makeRegistry();
    const fs = new InMemoryFileSystem();
    const git = new InMemoryGitProvider();

    const outcome = await runChecks(
      {
        registry,
        config: DEFAULT_CONFIG,
        cwd: '/project',
        fs,
        git,
        process: {} as unknown as import('@sentiness/check-sdk').ProcessRunner,
        logger: {} as unknown as import('@sentiness/check-sdk').Logger,
        clock: new FixedClock(0),
      },
      { tier: 'fast', diffOnly: true },
    );

    expect(outcome.context.tier).toBe('fast');
    expect(outcome.context.mode).toBe('diff');
    expect(outcome.durationMs).toBe(0);
  });

  it('adds load failures to results', async () => {
    const config = { ...DEFAULT_CONFIG, checks: { missing: { enabled: true } } };
    const registry = await makeRegistry(config);
    const fs = new InMemoryFileSystem();
    const git = new InMemoryGitProvider();

    const outcome = await runChecks(
      {
        registry,
        config,
        cwd: '/project',
        fs,
        git,
        process: {} as unknown as import('@sentiness/check-sdk').ProcessRunner,
        logger: {} as unknown as import('@sentiness/check-sdk').Logger,
        clock: new FixedClock(0),
      },
      { tier: 'fast', diffOnly: false },
    );

    const result = outcome.results.get(asCheckId('missing'));
    expect(result).toBeDefined();
    expect(result?.status).toBe('error');
    expect(result?.findings[0]?.message).toContain('Failed to load @sentiness/check-missing');
    expect(outcome.checkMetadata.get(asCheckId('missing'))?.category).toBe('platform');
  });

  it('handles checks throwing errors or skipping', async () => {
    const badCheck: Check = {
      id: asCheckId('bad'),
      category: 'lint',
      defaultTier: 'fast',
      detect: async () => {
        throw new Error('detect error');
      },
      run: async () => ({ status: 'ok', durationMs: 0, findings: [] }),
    };

    const unavailableCheck: Check = {
      id: asCheckId('unavail'),
      category: 'lint',
      defaultTier: 'fast',
      detect: async () => ({ available: false, reason: 'not installed' }),
      run: async () => ({ status: 'ok', durationMs: 0, findings: [] }),
    };

    const failingRunCheck: Check = {
      id: asCheckId('fail'),
      category: 'lint',
      defaultTier: 'fast',
      detect: async () => ({ available: true, version: '1.0' }),
      run: async () => {
        throw new Error('run error');
      },
    };

    // We hack the registry instance to contain our mock checks
    const registry = await makeRegistry();
    Object.defineProperty(registry, 'checks', {
      value: [badCheck, unavailableCheck, failingRunCheck],
    });

    const fs = new InMemoryFileSystem();
    const git = new InMemoryGitProvider();

    const outcome = await runChecks(
      {
        registry,
        config: DEFAULT_CONFIG,
        cwd: '/project',
        fs,
        git,
        process: {} as unknown as import('@sentiness/check-sdk').ProcessRunner,
        logger: {} as unknown as import('@sentiness/check-sdk').Logger,
        clock: new FixedClock(0),
      },
      { tier: 'fast', diffOnly: false },
    );

    const badRes = outcome.results.get(asCheckId('bad'));
    expect(badRes?.status).toBe('error');
    expect(badRes?.errorMessage).toBe('detect error');

    const unavailRes = outcome.results.get(asCheckId('unavail'));
    expect(unavailRes?.status).toBe('skipped');
    expect(unavailRes?.skipReason).toBe('not installed');

    const failRes = outcome.results.get(asCheckId('fail'));
    expect(failRes?.status).toBe('error');
    expect(failRes?.errorMessage).toBe('run error');
  });

  it('returns a check error when configSchema rejects checkConfig', async () => {
    const run = vi.fn();
    const configCheck: Check = {
      id: asCheckId('config-check'),
      category: 'lint',
      defaultTier: 'fast',
      configSchema: {
        parse: () => {
          throw new Error('threshold must be a number');
        },
      },
      detect: async () => ({ available: true }),
      run,
    };
    const registry = await makeRegistry();
    Object.defineProperty(registry, 'checks', {
      value: [configCheck],
    });
    const fs = new InMemoryFileSystem();
    const git = new InMemoryGitProvider();

    const outcome = await runChecks(
      {
        registry,
        config: DEFAULT_CONFIG,
        cwd: '/project',
        fs,
        git,
        process: {} as unknown as import('@sentiness/check-sdk').ProcessRunner,
        logger: {} as unknown as import('@sentiness/check-sdk').Logger,
        clock: new FixedClock(0),
      },
      { tier: 'fast', diffOnly: false },
    );

    const result = outcome.results.get(asCheckId('config-check'));
    expect(result?.status).toBe('error');
    expect(result?.errorMessage).toContain('Invalid config for check "config-check"');
    expect(result?.errorMessage).toContain('threshold must be a number');
    expect(run).not.toHaveBeenCalled();
  });
});

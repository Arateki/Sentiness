import { describe, expect, it } from 'vitest';
import { runChecks } from './runner.js';
import { CheckRegistry } from '../registry/registry.js';
import { DEFAULT_CONFIG } from '../config/config.js';
import { InMemoryFileSystem, InMemoryGitProvider, FixedClock } from '@sentiness/_test-utils';
import { asCheckId, asRuleId, type Check } from '@sentiness/check-sdk';

describe('runner', () => {
  it('throws on trigger and tier mismatch', async () => {
    const registry = await CheckRegistry.fromConfig(DEFAULT_CONFIG, process.cwd());
    const fs = new InMemoryFileSystem();
    const git = new InMemoryGitProvider();
    
    await expect(runChecks({
      registry,
      config: DEFAULT_CONFIG,
      cwd: '/project',
      fs,
      git,
      process: {} as any,
      logger: {} as any,
      clock: new FixedClock(0),
    }, { tier: 'slow', trigger: 'post-edit', diffOnly: false }))
      .rejects.toThrow(/Trigger "post-edit" belongs to "fast", not "slow"/);
  });

  it('runs successfully with empty registry', async () => {
    const registry = await CheckRegistry.fromConfig(DEFAULT_CONFIG, process.cwd());
    const fs = new InMemoryFileSystem();
    const git = new InMemoryGitProvider();
    
    const outcome = await runChecks({
      registry,
      config: DEFAULT_CONFIG,
      cwd: '/project',
      fs,
      git,
      process: {} as any,
      logger: {} as any,
      clock: new FixedClock(0),
    }, { tier: 'fast', diffOnly: true });

    expect(outcome.context.tier).toBe('fast');
    expect(outcome.context.mode).toBe('diff');
    expect(outcome.durationMs).toBe(0);
  });

  it('adds load failures to results', async () => {
    const config = { ...DEFAULT_CONFIG, checks: { 'missing': { enabled: true } } };
    const registry = await CheckRegistry.fromConfig(config, process.cwd());
    const fs = new InMemoryFileSystem();
    const git = new InMemoryGitProvider();
    
    const outcome = await runChecks({
      registry,
      config,
      cwd: '/project',
      fs,
      git,
      process: {} as any,
      logger: {} as any,
      clock: new FixedClock(0),
    }, { tier: 'fast', diffOnly: false });

    const result = outcome.results.get(asCheckId('missing'));
    expect(result).toBeDefined();
    expect(result!.status).toBe('error');
    expect(result!.findings[0]!.message).toContain('Failed to load @sentiness/check-missing');
  });

  it('handles checks throwing errors or skipping', async () => {
    const badCheck: Check = {
      id: asCheckId('bad'),
      category: 'lint',
      defaultTier: 'fast',
      detect: async () => { throw new Error('detect error'); },
      run: async () => ({ status: 'ok', durationMs: 0, findings: [] })
    };

    const unavailableCheck: Check = {
      id: asCheckId('unavail'),
      category: 'lint',
      defaultTier: 'fast',
      detect: async () => ({ available: false, reason: 'not installed' }),
      run: async () => ({ status: 'ok', durationMs: 0, findings: [] })
    };

    const failingRunCheck: Check = {
      id: asCheckId('fail'),
      category: 'lint',
      defaultTier: 'fast',
      detect: async () => ({ available: true, version: '1.0' }),
      run: async () => { throw new Error('run error'); }
    };

    // We hack the registry instance to contain our mock checks
    const registry = await CheckRegistry.fromConfig(DEFAULT_CONFIG, process.cwd());
    (registry as any).checks = [badCheck, unavailableCheck, failingRunCheck];

    const fs = new InMemoryFileSystem();
    const git = new InMemoryGitProvider();
    
    const outcome = await runChecks({
      registry,
      config: DEFAULT_CONFIG,
      cwd: '/project',
      fs,
      git,
      process: {} as any,
      logger: {} as any,
      clock: new FixedClock(0),
    }, { tier: 'fast', diffOnly: false });

    const badRes = outcome.results.get(asCheckId('bad'));
    expect(badRes!.status).toBe('error');
    expect(badRes!.errorMessage).toBe('detect error');

    const unavailRes = outcome.results.get(asCheckId('unavail'));
    expect(unavailRes!.status).toBe('skipped');
    expect(unavailRes!.skipReason).toBe('not installed');

    const failRes = outcome.results.get(asCheckId('fail'));
    expect(failRes!.status).toBe('error');
    expect(failRes!.errorMessage).toBe('run error');
  });
});

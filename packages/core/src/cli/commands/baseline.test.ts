import {
  FixedClock,
  InMemoryFileSystem,
  InMemoryGitProvider,
  SilentLogger,
} from '@sentiness/_test-utils';
import { asCheckId, asRuleId, type Check, type Finding, type Tier } from '@sentiness/check-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../../config/config.js';
import { CheckRegistry } from '../../registry/registry.js';
import {
  baselineAcceptCommand,
  baselineInitCommand,
  baselinePruneCommand,
  baselineUpdateCommand,
} from './baseline.js';

// Create a basic outcome string to act as baseline.json
const emptyBaseline = JSON.stringify({
  schemaVersion: '1.0',
  createdAt: '2024-01-01T00:00:00.000Z',
  createdAtCommit: 'sha',
  suppressed: [],
  metrics: { 'fake.score': { value: 50, direction: 'higher-is-better' } },
});

const fakeCheckId = asCheckId('fake');
const fakeRuleId = asRuleId('rule');
const fakeFingerprint = 'f'.repeat(64);

describe('baseline commands', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const setupDeps = () => {
    const fs = new InMemoryFileSystem({
      '/project/sentiness.config.json': JSON.stringify(DEFAULT_CONFIG),
    });
    return {
      cwd: '/project',
      fs,
      git: new InMemoryGitProvider(),
      clock: new FixedClock(0),
      logger: new SilentLogger(),
      processRunner: {} as unknown as import('@sentiness/check-sdk').ProcessRunner,
      stdout: { write: vi.fn() },
    };
  };

  function stubRegistry(
    checksByTier: Partial<Record<Tier, readonly Check[]>>,
    seenTiers: Tier[] = [],
  ): void {
    const registry = {
      filterByTier: (tier: Tier) => {
        seenTiers.push(tier);
        return checksByTier[tier] ?? [];
      },
      loadFailures: () => [],
    } as unknown as CheckRegistry;
    vi.spyOn(CheckRegistry, 'fromResolved').mockResolvedValue(registry);
  }

  function metricCheck(value: number): Check {
    return {
      id: fakeCheckId,
      category: 'coverage',
      defaultTier: 'fast',
      metricSpecs: {
        score: { direction: 'higher-is-better', description: 'Fake score' },
      },
      detect: async () => ({ available: true }),
      run: async () => ({ status: 'ok', findings: [], durationMs: 0, metrics: { score: value } }),
    };
  }

  function findingCheck(defaultTier: Tier): Check {
    const finding: Finding = {
      id: 'fake:rule',
      checkId: fakeCheckId,
      ruleId: fakeRuleId,
      severity: 'error',
      message: 'Fake finding',
      location: { file: 'src/index.ts' },
      fingerprint: fakeFingerprint,
    };
    return {
      id: fakeCheckId,
      category: 'lint',
      defaultTier,
      detect: async () => ({ available: true }),
      run: async () => ({
        status: 'violations',
        findings: [finding],
        durationMs: 0,
      }),
    };
  }

  describe('baseline init', () => {
    it('creates an initial baseline', async () => {
      const deps = setupDeps();
      const exitCode = await baselineInitCommand({}, deps);
      expect(exitCode).toBe(0);
      const exists = await deps.fs.exists('/project/.sentiness/baseline.json');
      expect(exists).toBe(true);
    });
  });

  describe('baseline update', () => {
    it('fails if no baseline exists', async () => {
      const deps = setupDeps();
      const exitCode = await baselineUpdateCommand({}, deps);
      expect(exitCode).toBe(1);
    });

    it('updates metrics successfully', async () => {
      const deps = setupDeps();
      await deps.fs.mkdir('/project/.sentiness', { recursive: true });
      await deps.fs.writeFile('/project/.sentiness/baseline.json', emptyBaseline);
      const exitCode = await baselineUpdateCommand({}, deps);
      expect(exitCode).toBe(0);
    });

    it('rejects ratchet downward without --force when metric targeted (C-1)', async () => {
      const deps = setupDeps();
      await deps.fs.mkdir('/project/.sentiness', { recursive: true });
      await deps.fs.writeFile('/project/.sentiness/baseline.json', emptyBaseline);
      stubRegistry({ fast: [metricCheck(40)] });

      const exitCode = await baselineUpdateCommand({ metric: 'fake.score' }, deps);

      expect(exitCode).toBe(1);
      const baseline = JSON.parse(await deps.fs.readFile('/project/.sentiness/baseline.json'));
      expect(baseline.metrics['fake.score'].value).toBe(50);
      expect(deps.logger.records.some((record) => record.message.includes('regressed'))).toBe(true);
    });

    it('allows ratchet downward only with --force when metric targeted (C-1)', async () => {
      const deps = setupDeps();
      await deps.fs.mkdir('/project/.sentiness', { recursive: true });
      await deps.fs.writeFile('/project/.sentiness/baseline.json', emptyBaseline);
      stubRegistry({ fast: [metricCheck(40)] });

      const exitCode = await baselineUpdateCommand({ metric: 'fake.score', force: true }, deps);

      expect(exitCode).toBe(0);
      const baseline = JSON.parse(await deps.fs.readFile('/project/.sentiness/baseline.json'));
      expect(baseline.metrics['fake.score'].value).toBe(40);
      expect(
        deps.logger.records.some((record) =>
          record.message.includes('Forcing metric "fake.score"'),
        ),
      ).toBe(true);
    });
  });

  describe('baseline accept', () => {
    it('fails if no baseline exists', async () => {
      const deps = setupDeps();
      const exitCode = await baselineAcceptCommand({ fingerprint: 'x', reason: 'r' }, deps);
      expect(exitCode).toBe(1);
    });

    it('fails without reason or fingerprint', async () => {
      const deps = setupDeps();
      await deps.fs.mkdir('/project/.sentiness', { recursive: true });
      await deps.fs.writeFile('/project/.sentiness/baseline.json', emptyBaseline);

      expect(await baselineAcceptCommand({ fingerprint: 'x' }, deps)).toBe(1);
      expect(await baselineAcceptCommand({ reason: 'r' }, deps)).toBe(1);
    });

    it('fails if finding fingerprint is not found in run', async () => {
      const deps = setupDeps();
      await deps.fs.mkdir('/project/.sentiness', { recursive: true });
      await deps.fs.writeFile('/project/.sentiness/baseline.json', emptyBaseline);

      const exitCode = await baselineAcceptCommand(
        { fingerprint: 'non-existent', reason: 'r' },
        deps,
      );
      expect(exitCode).toBe(1);
    });

    it('only searches the requested tier when accepting a finding (M-4)', async () => {
      const deps = setupDeps();
      await deps.fs.mkdir('/project/.sentiness', { recursive: true });
      await deps.fs.writeFile('/project/.sentiness/baseline.json', emptyBaseline);
      const seenTiers: Tier[] = [];
      stubRegistry({ standard: [findingCheck('standard')] }, seenTiers);

      const exitCode = await baselineAcceptCommand(
        { fingerprint: fakeFingerprint, reason: 'accepted' },
        deps,
      );

      expect(exitCode).toBe(1);
      expect(seenTiers).toEqual(['fast']);
      expect(deps.logger.records.some((record) => record.message.includes('--tier=standard'))).toBe(
        true,
      );
    });

    it('finds a finding in an explicitly selected accept tier (M-4)', async () => {
      const deps = setupDeps();
      await deps.fs.mkdir('/project/.sentiness', { recursive: true });
      await deps.fs.writeFile('/project/.sentiness/baseline.json', emptyBaseline);
      const seenTiers: Tier[] = [];
      stubRegistry({ standard: [findingCheck('standard')] }, seenTiers);

      const exitCode = await baselineAcceptCommand(
        { fingerprint: fakeFingerprint, reason: 'accepted', tier: 'standard' },
        deps,
      );

      expect(exitCode).toBe(0);
      expect(seenTiers).toEqual(['standard']);
      const baseline = JSON.parse(await deps.fs.readFile('/project/.sentiness/baseline.json'));
      expect(baseline.suppressed).toHaveLength(1);
      expect(baseline.suppressed[0].fingerprint).toBe(fakeFingerprint);
    });

    it('accepts successfully if finding is found', async () => {
      const deps = setupDeps();
      await deps.fs.mkdir('/project/.sentiness', { recursive: true });
      await deps.fs.writeFile('/project/.sentiness/baseline.json', emptyBaseline);

      // Inject the finding into the registry synthetic failures to ensure it appears in the outcome.
      // The check id 'invalid@@' fails the registry's pattern check and produces a synthetic finding
      // with fingerprint '0'.repeat(64).
      const config = { ...DEFAULT_CONFIG, checks: { 'invalid@@': { version: '1.0.0' } } };
      await deps.fs.writeFile('/project/sentiness.config.json', JSON.stringify(config));

      // The synthetic load failure will generate a finding with fingerprint '000...000'
      const fp = '0'.repeat(64);
      const exitCode = await baselineAcceptCommand({ fingerprint: fp, reason: 'accepted' }, deps);
      expect(exitCode).toBe(0);

      // Also test a failure inside BaselineManager.accept (like empty reason passing through somehow)
      // Actually we already test that in baseline unit tests, but we can verify exit code 1
      const exitCodeErr = await baselineAcceptCommand({ fingerprint: fp, reason: '   ' }, deps);
      expect(exitCodeErr).toBe(1);
    });
  });

  describe('baseline prune', () => {
    it('fails if no baseline exists', async () => {
      const deps = setupDeps();
      const exitCode = await baselinePruneCommand({}, deps);
      expect(exitCode).toBe(1);
    });

    it('prunes baseline successfully', async () => {
      const deps = setupDeps();
      await deps.fs.mkdir('/project/.sentiness', { recursive: true });
      await deps.fs.writeFile('/project/.sentiness/baseline.json', emptyBaseline);
      const exitCode = await baselinePruneCommand({}, deps);
      expect(exitCode).toBe(0);
    });
  });
});

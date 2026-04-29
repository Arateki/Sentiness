import {
  FixedClock,
  InMemoryFileSystem,
  InMemoryGitProvider,
  SilentLogger,
} from '@sentiness/_test-utils';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../../config/config.js';
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

describe('baseline commands', () => {
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

    it('accepts successfully if finding is found', async () => {
      const deps = setupDeps();
      await deps.fs.mkdir('/project/.sentiness', { recursive: true });
      await deps.fs.writeFile('/project/.sentiness/baseline.json', emptyBaseline);

      // Inject the finding into the registry synthetic failures to ensure it appears in the outcome
      const config = { ...DEFAULT_CONFIG, checks: { 'invalid@@': { enabled: true } } };
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

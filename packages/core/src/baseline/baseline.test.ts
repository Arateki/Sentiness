import { InMemoryFileSystem, InMemoryGitProvider, FixedClock } from '@sentiness/_test-utils';
import { describe, expect, it } from 'vitest';
import { BaselineManager, BaselineParseError, BaselineAcceptError, type BaselineSnapshot } from './baseline.js';
import type { RunOutcome } from '../runner/runner.js';
import { asCheckId, asRuleId } from '@sentiness/check-sdk';

describe('baseline', () => {
  describe('load', () => {
    it('returns undefined if file does not exist', async () => {
      const fs = new InMemoryFileSystem();
      expect(await BaselineManager.load('/project/baseline.json', fs)).toBeUndefined();
    });

    it('throws BaselineParseError on invalid JSON', async () => {
      const fs = new InMemoryFileSystem({
        '/project/baseline.json': 'invalid json',
      });
      await expect(BaselineManager.load('/project/baseline.json', fs)).rejects.toThrow(BaselineParseError);
    });

    it('throws BaselineParseError on missing schemaVersion', async () => {
      const fs = new InMemoryFileSystem({
        '/project/baseline.json': JSON.stringify({ createdAt: 'now' }),
      });
      await expect(BaselineManager.load('/project/baseline.json', fs)).rejects.toThrow(BaselineParseError);
    });

    it('loads valid baseline', async () => {
      const snapshot: BaselineSnapshot = {
        schemaVersion: '1.0',
        createdAt: '2024',
        createdAtCommit: 'sha',
        suppressed: [],
        metrics: {}
      };
      const fs = new InMemoryFileSystem({
        '/project/baseline.json': JSON.stringify(snapshot),
      });
      const loaded = await BaselineManager.load('/project/baseline.json', fs);
      expect(loaded).toEqual(snapshot);
    });
  });

  describe('save', () => {
    it('saves sorted baseline', async () => {
      const fs = new InMemoryFileSystem();
      const snapshot: BaselineSnapshot = {
        schemaVersion: '1.0',
        createdAt: '2024',
        createdAtCommit: 'sha',
        suppressed: [
          { checkId: 'b', ruleId: 'b', fingerprint: 'z', location: { file: 'a' }, addedAt: '', reason: '' },
          { checkId: 'a', ruleId: 'a', fingerprint: 'a', location: { file: 'a' }, addedAt: '', reason: '' },
        ],
        metrics: {}
      };
      await BaselineManager.save('/project/baseline.json', snapshot, fs);
      const content = await fs.readFile('/project/baseline.json');
      const loaded = JSON.parse(content) as BaselineSnapshot;
      expect(loaded.suppressed[0]!.fingerprint).toBe('a');
      expect(loaded.suppressed[1]!.fingerprint).toBe('z');
    });
  });

  describe('createFromOutcome', () => {
    it('creates baseline from outcome with findings and metrics', async () => {
      const outcome: RunOutcome = {
        runId: 'run',
        startedAt: '2024',
        completedAt: '2024',
        durationMs: 100,
        context: {} as any,
        checkMetadata: new Map(),
        results: new Map([
          [asCheckId('fake'), {
            status: 'violations',
            durationMs: 10,
            findings: [
              {
                id: '1',
                checkId: asCheckId('fake'),
                ruleId: asRuleId('rule'),
                severity: 'error',
                message: 'msg',
                location: { file: 'a', startLine: 1 },
                fingerprint: 'fp',
              }
            ],
            metrics: { score: 100 }
          }]
        ])
      };

      const git = new InMemoryGitProvider();
      const snapshot = await BaselineManager.createFromOutcome(outcome, git, '/project');
      
      expect(snapshot.schemaVersion).toBe('1.0');
      expect(snapshot.createdAtCommit).toBe('HEAD');
      expect(snapshot.suppressed).toHaveLength(1);
      expect(snapshot.suppressed[0]!.fingerprint).toBe('fp');
      expect(snapshot.metrics['fake.score']).toEqual({ value: 100, direction: 'higher-is-better' });
    });
  });

  describe('prune', () => {
    it('removes unused fingerprints', () => {
      const snapshot: BaselineSnapshot = {
        schemaVersion: '1.0',
        createdAt: '2024',
        createdAtCommit: 'sha',
        suppressed: [
          { checkId: 'a', ruleId: 'a', fingerprint: 'keep', location: { file: 'a' }, addedAt: '', reason: '' },
          { checkId: 'b', ruleId: 'b', fingerprint: 'drop', location: { file: 'a' }, addedAt: '', reason: '' },
        ],
        metrics: {}
      };
      const pruned = BaselineManager.prune(snapshot, new Set(['keep']));
      expect(pruned.suppressed).toHaveLength(1);
      expect(pruned.suppressed[0]!.fingerprint).toBe('keep');
    });
  });

  describe('accept', () => {
    it('throws if reason is empty', () => {
      const snapshot: BaselineSnapshot = { schemaVersion: '1.0', createdAt: '2024', createdAtCommit: 'sha', suppressed: [], metrics: {} };
      const finding = { checkId: asCheckId('a'), ruleId: asRuleId('a'), fingerprint: 'new', location: { file: 'a' }, severity: 'error', message: 'm', id: '1' } as any;
      expect(() => BaselineManager.accept(snapshot, finding, '   ')).toThrow(BaselineAcceptError);
    });

    it('adds entry with reason', () => {
      const snapshot: BaselineSnapshot = { schemaVersion: '1.0', createdAt: '2024', createdAtCommit: 'sha', suppressed: [], metrics: {} };
      const finding = { checkId: asCheckId('a'), ruleId: asRuleId('a'), fingerprint: 'new', location: { file: 'a', startLine: 1 }, severity: 'error', message: 'm', id: '1' } as any;
      const updated = BaselineManager.accept(snapshot, finding, 'wontfix');
      expect(updated.suppressed).toHaveLength(1);
      expect(updated.suppressed[0]!.fingerprint).toBe('new');
      expect(updated.suppressed[0]!.reason).toBe('wontfix');
      expect(updated.suppressed[0]!.location.startLine).toBe(1);
    });
  });
});

import { InMemoryFileSystem } from '@sentiness/_test-utils';
import { describe, expect, it } from 'vitest';
import { codexAdapter } from './codex.js';

describe('codexAdapter', () => {
  it('installs into AGENTS.md', async () => {
    const fs = new InMemoryFileSystem();
    const result = await codexAdapter.install('/repo', fs, {
      sentinessVersion: '0.1.0',
      configPath: 'sentiness.config.json',
      baselinePath: '.sentiness/baseline.json',
      pendingPath: '.sentiness/pending-feedback.json',
    });

    expect(result.targetPath).toBe('/repo/AGENTS.md');
    expect(await fs.readFile('/repo/AGENTS.md')).toContain('Sentiness Agent Instructions');
  });
});

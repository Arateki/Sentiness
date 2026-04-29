import { InMemoryFileSystem } from '@sentiness/_test-utils';
import { describe, expect, it } from 'vitest';
import { geminiAdapter } from './gemini.js';

describe('geminiAdapter', () => {
  it('installs into GEMINI.md', async () => {
    const fs = new InMemoryFileSystem();
    const result = await geminiAdapter.install('/repo', fs, {
      sentinessVersion: '0.1.0',
      configPath: 'sentiness.config.json',
      baselinePath: '.sentiness/baseline.json',
      pendingPath: '.sentiness/pending-feedback.json',
    });

    expect(result.targetPath).toBe('/repo/GEMINI.md');
    expect(await fs.readFile('/repo/GEMINI.md')).toContain('Sentiness Agent Instructions');
  });
});

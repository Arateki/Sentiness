import { InMemoryFileSystem } from '@sentiness/_test-utils';
import { describe, expect, it } from 'vitest';
import { codexAdapter, codexSkillAdapter } from './codex.js';

const renderOptions = {
  sentinessVersion: '0.1.0',
  configPath: 'sentiness.config.json',
  baselinePath: '.sentiness/baseline.json',
  pendingPath: '.sentiness/pending-feedback.json',
};

describe('codexAdapter', () => {
  it('installs into AGENTS.md', async () => {
    const fs = new InMemoryFileSystem();
    const result = await codexAdapter.install('/repo', fs, renderOptions);

    expect(result.targetPath).toBe('/repo/AGENTS.md');
    expect(await fs.readFile('/repo/AGENTS.md')).toContain('Sentiness Agent Instructions');
  });
});

describe('codexSkillAdapter', () => {
  it('writes a whole-file repo-scoped Codex skill with frontmatter', async () => {
    const fs = new InMemoryFileSystem();
    const result = await codexSkillAdapter.install('/repo', fs, renderOptions);

    expect(result).toEqual({
      agent: 'codex-skill',
      targetPath: '/repo/.agents/skills/sentiness/SKILL.md',
      changed: true,
    });
    const content = await fs.readFile('/repo/.agents/skills/sentiness/SKILL.md');
    expect(content.startsWith('---\nname: sentiness\n')).toBe(true);
    expect(content).toContain('description:');
    expect(content).toContain('Sentiness Agent Instructions');
    expect(content).not.toContain('sentiness:start');
  });

  it('is idempotent: reinstalling with the same options reports changed: false', async () => {
    const fs = new InMemoryFileSystem();
    await codexSkillAdapter.install('/repo', fs, renderOptions);
    const second = await codexSkillAdapter.install('/repo', fs, renderOptions);

    expect(second.changed).toBe(false);
  });
});

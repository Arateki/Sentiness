import { describe, expect, it } from 'vitest';
import { getAdapter, listAdapters, TEMPLATE_VERSION } from './index.js';

describe('adapter registry', () => {
  it('lists all supported agent adapters', () => {
    expect(TEMPLATE_VERSION).toBe('1.1');
    expect(
      listAdapters().map((adapter) => ({
        agent: adapter.agent,
        targetFile: adapter.targetFile,
      })),
    ).toEqual([
      { agent: 'claude-code', targetFile: 'CLAUDE.md' },
      { agent: 'codex', targetFile: 'AGENTS.md' },
      { agent: 'gemini', targetFile: 'GEMINI.md' },
    ]);
  });

  it('returns a single adapter by agent name', () => {
    expect(getAdapter('claude-code')?.targetFile).toBe('CLAUDE.md');
    expect(getAdapter('codex')?.targetFile).toBe('AGENTS.md');
    expect(getAdapter('gemini')?.targetFile).toBe('GEMINI.md');
  });
});

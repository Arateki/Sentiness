import { InMemoryFileSystem } from '@sentiness/_test-utils';
import { describe, expect, it } from 'vitest';
import {
  ConfigNotFoundError,
  ConfigParseError,
  categoryFromString,
  loadConfig,
  resolveConfig,
  validateConfig,
} from './config.js';

describe('config', () => {
  it('applies defaults', () => {
    const config = resolveConfig(validateConfig({ schemaVersion: '1.0', checks: {} }));

    expect(config.tiers.fast.triggers).toContain('post-edit');
    expect(config.baseline.path).toBe('.sentiness/baseline.json');
  });

  it('rejects duplicate triggers', () => {
    expect(() =>
      resolveConfig(
        validateConfig({
          schemaVersion: '1.0',
          tiers: {
            fast: { triggers: ['pre-done'] },
            standard: { triggers: ['pre-done'] },
          },
        }),
      ),
    ).toThrow(ConfigParseError);
    expect(() =>
      resolveConfig(
        validateConfig({
          schemaVersion: '1.0',
          tiers: {
            fast: { triggers: ['pre-done'] },
            standard: { triggers: ['pre-done'] },
          },
        }),
      ),
    ).toThrow(/appears in both/);
  });

  it('throws ConfigParseError with normalized Zod error', () => {
    expect(() => validateConfig({ schemaVersion: 'invalid' })).toThrow(ConfigParseError);
    expect(() => validateConfig({ schemaVersion: 'invalid' })).toThrow(/schemaVersion: Invalid/);
  });

  it('categoryFromString returns valid category or undefined', () => {
    expect(categoryFromString('lint')).toBe('lint');
    expect(categoryFromString('security')).toBe('security');
    expect(categoryFromString('platform')).toBe('platform');
    expect(categoryFromString('invalid-category')).toBeUndefined();
  });

  describe('agents', () => {
    it('accepts every supported agent adapter name', () => {
      const config = resolveConfig(
        validateConfig({
          schemaVersion: '1.0',
          agents: ['claude-code', 'claude-code-skill', 'codex', 'codex-skill', 'gemini'],
        }),
      );
      expect(config.agents).toEqual([
        'claude-code',
        'claude-code-skill',
        'codex',
        'codex-skill',
        'gemini',
      ]);
    });

    it('rejects unknown agent names', () => {
      expect(() => validateConfig({ schemaVersion: '1.0', agents: ['vscode'] })).toThrow(
        ConfigParseError,
      );
    });
  });

  describe('loadConfig', () => {
    it('throws ConfigNotFoundError when no config is found', async () => {
      const fs = new InMemoryFileSystem();
      await expect(loadConfig('/project', fs)).rejects.toThrow(ConfigNotFoundError);
    });

    it('loads and resolves sentiness.config.json', async () => {
      const fs = new InMemoryFileSystem({
        '/project/sentiness.config.json': JSON.stringify({ schemaVersion: '1.0', checks: {} }),
      });
      const config = await loadConfig('/project', fs);
      expect(config.schemaVersion).toBe('1.0');
      expect(config.baseline.path).toBe('.sentiness/baseline.json');
    });

    it('throws ConfigParseError on invalid JSON syntax in sentiness.config.json', async () => {
      const fs = new InMemoryFileSystem({
        '/project/sentiness.config.json': 'invalid { json',
      });
      await expect(loadConfig('/project', fs)).rejects.toThrow(ConfigParseError);
      await expect(loadConfig('/project', fs)).rejects.toThrow(/Invalid JSON in/);
    });
  });
});

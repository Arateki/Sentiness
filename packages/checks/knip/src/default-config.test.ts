import { asCheckId } from '@sentiness/check-sdk';
import { describe, expect, it } from 'vitest';
import { buildKnipDefaultConfig } from './default-config.js';

describe('buildKnipDefaultConfig', () => {
  it('writes knip.json with the @sentiness scope plus enabled checks tools only', () => {
    const result = buildKnipDefaultConfig({
      enabledCheckIds: [asCheckId('biome'), asCheckId('knip'), asCheckId('eslint')],
    });
    expect(result.path).toBe('knip.json');
    const parsed = JSON.parse(result.content);
    expect(parsed.$schema).toContain('knip');
    expect(parsed.ignoreDependencies).toEqual([
      '@sentiness/.*',
      'biome',
      '@biomejs/biome',
      'knip',
      'eslint',
    ]);
  });

  it('emits only the scope when no enabled check wraps an npm tool', () => {
    const result = buildKnipDefaultConfig({
      enabledCheckIds: [asCheckId('coverage'), asCheckId('deps-diff')],
    });
    expect(JSON.parse(result.content).ignoreDependencies).toEqual(['@sentiness/.*']);
  });

  it('produces valid, newline-terminated JSON', () => {
    const result = buildKnipDefaultConfig({ enabledCheckIds: [asCheckId('biome')] });
    expect(result.content.endsWith('\n')).toBe(true);
    expect(() => JSON.parse(result.content)).not.toThrow();
  });

  it('does not duplicate tools shared across checks', () => {
    const result = buildKnipDefaultConfig({
      enabledCheckIds: [asCheckId('biome'), asCheckId('biome')],
    });
    const deps = JSON.parse(result.content).ignoreDependencies;
    expect(deps).toEqual(['@sentiness/.*', 'biome', '@biomejs/biome']);
  });
});

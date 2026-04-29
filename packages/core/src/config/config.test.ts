import { describe, expect, it } from 'vitest';
import { resolveConfig, validateConfig } from './config.js';

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
    ).toThrow(/appears in both/);
  });
});

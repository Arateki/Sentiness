import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  asCheckId,
  asRuleId,
  type Check,
  type CheckContext,
  type CheckId,
  compareSeverity,
  type Finding,
  type ProcessRunner,
  severityValue,
} from './index.js';

describe('SDK types', () => {
  it('exports branded constructors', () => {
    expectTypeOf(asCheckId('biome')).toEqualTypeOf<CheckId>();
    expect(asCheckId('biome')).toBe('biome');
    expect(asRuleId('lint/style/useConst')).toBe('lint/style/useConst');
  });

  it('keeps Check small', () => {
    expectTypeOf<Check>().toHaveProperty('detect');
    expectTypeOf<Check>().toHaveProperty('run');
    expectTypeOf<Check>().toHaveProperty('dispose');
  });

  it('types process runner as an injected dependency', () => {
    expectTypeOf<CheckContext>().toHaveProperty('process');
    expectTypeOf<CheckContext['process']>().toEqualTypeOf<ProcessRunner>();
  });

  it('types findings with fingerprints', () => {
    expectTypeOf<Finding>().toHaveProperty('fingerprint');
    expectTypeOf<Finding['fingerprint']>().toEqualTypeOf<string>();
  });

  it('orders severities from most severe to least severe', () => {
    expect(['warning', 'error', 'info'].sort(compareSeverity)).toEqual([
      'error',
      'warning',
      'info',
    ]);
    expect(severityValue('error')).toBeGreaterThan(severityValue('warning'));
  });
});

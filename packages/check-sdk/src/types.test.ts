import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  asCheckId,
  asRuleId,
  type Check,
  type CheckContext,
  type CheckDefaultConfig,
  type CheckId,
  compareSeverity,
  type DefaultConfigContext,
  type ExecFileOptions,
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

  it('passes the enabled check ids to a context-aware defaultConfig', () => {
    expectTypeOf<Check>().toHaveProperty('defaultConfig');
    expectTypeOf<Check>().toHaveProperty('configOptional');
    expectTypeOf<DefaultConfigContext>().toHaveProperty('enabledCheckIds');
    expectTypeOf<DefaultConfigContext['enabledCheckIds']>().toEqualTypeOf<readonly CheckId[]>();
    expectTypeOf<NonNullable<Check['defaultConfig']>>().toEqualTypeOf<
      (ctx: DefaultConfigContext) => CheckDefaultConfig
    >();
    expectTypeOf<Check['configOptional']>().toEqualTypeOf<boolean | undefined>();
  });

  it('types process runner as an injected dependency', () => {
    expectTypeOf<CheckContext>().toHaveProperty('process');
    expectTypeOf<CheckContext['process']>().toEqualTypeOf<ProcessRunner>();
  });

  it('types findings with fingerprints', () => {
    expectTypeOf<Finding>().toHaveProperty('fingerprint');
    expectTypeOf<Finding['fingerprint']>().toEqualTypeOf<string>();
  });

  it('threads slot bin paths through the context and exec options', () => {
    expectTypeOf<CheckContext['binPaths']>().toEqualTypeOf<readonly string[] | undefined>();
    expectTypeOf<ExecFileOptions['binPaths']>().toEqualTypeOf<readonly string[] | undefined>();
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

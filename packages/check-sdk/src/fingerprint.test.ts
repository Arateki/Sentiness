import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { asCheckId, asRuleId, computeFingerprint, normalizeFingerprintLine } from './index.js';

describe('fingerprint', () => {
  it('normalizes insignificant whitespace', () => {
    expect(normalizeFingerprintLine('  const   value = 1;\n')).toBe('const value = 1;');
  });

  it('produces stable 64-char lowercase hex', () => {
    const fingerprint = computeFingerprint({
      checkId: asCheckId('biome'),
      ruleId: asRuleId('style/useConst'),
      relativeFilePath: 'src/index.ts',
      lineContent: 'let value = 1;',
    });

    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it('treats empty discriminator like undefined', () => {
    const base = {
      checkId: asCheckId('biome'),
      ruleId: asRuleId('style/useConst'),
      relativeFilePath: 'src/index.ts',
      lineContent: 'let value = 1;',
    };

    expect(computeFingerprint(base)).toBe(computeFingerprint({ ...base, extraDiscriminator: '' }));
  });

  it('separates fields with NUL to avoid concatenation collisions', () => {
    const first = computeFingerprint({
      checkId: asCheckId('a'),
      ruleId: asRuleId('bc'),
      relativeFilePath: 'x',
      lineContent: 'y',
    });
    const second = computeFingerprint({
      checkId: asCheckId('ab'),
      ruleId: asRuleId('c'),
      relativeFilePath: 'x',
      lineContent: 'y',
    });

    expect(first).not.toBe(second);
  });

  it('is deterministic for arbitrary input', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), fc.string(), fc.string(), (check, rule, file, line) => {
        const input = {
          checkId: asCheckId(check),
          ruleId: asRuleId(rule),
          relativeFilePath: file,
          lineContent: line,
        };
        expect(computeFingerprint(input)).toBe(computeFingerprint(input));
      }),
    );
  });
});

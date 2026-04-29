import { createHash } from 'node:crypto';
import type { CheckId, RuleId } from './types.js';

export type FingerprintInput = {
  readonly checkId: CheckId;
  readonly ruleId: RuleId;
  readonly relativeFilePath: string;
  readonly lineContent: string;
  readonly extraDiscriminator?: string;
};

export function normalizeFingerprintLine(line: string): string {
  return line
    .replace(/\r?\n$/, '')
    .trim()
    .replace(/\s+/g, ' ');
}

export function computeFingerprint(input: FingerprintInput): string {
  const normalizedLine = normalizeFingerprintLine(input.lineContent);
  const payload = [
    input.checkId,
    input.ruleId,
    input.relativeFilePath,
    normalizedLine,
    input.extraDiscriminator ?? '',
  ].join('\u0000');

  return createHash('sha256').update(payload).digest('hex');
}

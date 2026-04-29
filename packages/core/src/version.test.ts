import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { readSentinessVersion, SENTINESS_VERSION } from './version.js';

const PackageMetadataSchema = z.object({
  version: z.string().min(1),
});

function packageVersion(): string {
  const parsed: unknown = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  );
  return PackageMetadataSchema.parse(parsed).version;
}

describe('SENTINESS_VERSION', () => {
  it('comes from the package metadata instead of a duplicated literal', () => {
    expect(SENTINESS_VERSION).toBe(packageVersion());
    expect(readSentinessVersion()).toBe(packageVersion());
  });
});

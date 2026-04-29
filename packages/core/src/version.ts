import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const PackageMetadataSchema = z.object({
  version: z.string().min(1),
});

function packageJsonPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
}

export function readSentinessVersion(): string {
  const parsed: unknown = JSON.parse(readFileSync(packageJsonPath(), 'utf8'));
  return PackageMetadataSchema.parse(parsed).version;
}

export const SENTINESS_VERSION = readSentinessVersion();

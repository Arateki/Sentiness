import { z } from 'zod';
import { parsePnpmLockfile } from './pnpm-lockfile.js';
import { parseYarnLockfile } from './yarn-lockfile.js';

type LockfileKind = 'package-lock' | 'pnpm-lock' | 'yarn-lock';

export type LockfilePackages = ReadonlyMap<string, string>;

const NpmLockEntrySchema = z
  .object({
    version: z.string().optional(),
    resolved: z.string().optional(),
    dev: z.boolean().optional(),
    optional: z.boolean().optional(),
  })
  .catchall(z.unknown());

const NpmLockfileSchema = z
  .object({
    lockfileVersion: z.number().optional(),
    packages: z.record(z.string(), NpmLockEntrySchema).optional(),
  })
  .catchall(z.unknown());

function packageNameFromPath(path: string): string | undefined {
  // Lockfile paths look like 'node_modules/foo' or
  // 'node_modules/foo/node_modules/@scope/bar'. We always pick the segment
  // after the last 'node_modules/' marker so nested deps resolve correctly.
  const marker = 'node_modules/';
  const lastIndex = path.lastIndexOf(marker);
  if (lastIndex < 0) {
    return undefined;
  }
  const tail = path.slice(lastIndex + marker.length);
  if (tail.length === 0) {
    return undefined;
  }
  if (tail.startsWith('@')) {
    const slash = tail.indexOf('/');
    if (slash < 0) {
      return tail;
    }
    const second = tail.indexOf('/', slash + 1);
    return second < 0 ? tail : tail.slice(0, second);
  }
  const slash = tail.indexOf('/');
  return slash < 0 ? tail : tail.slice(0, slash);
}

export function parseNpmLockfile(content: string): LockfilePackages | undefined {
  let parsed: z.infer<typeof NpmLockfileSchema>;
  try {
    parsed = NpmLockfileSchema.parse(JSON.parse(content));
  } catch {
    return undefined;
  }
  if (!parsed.packages) {
    return undefined;
  }
  const versions = new Map<string, string>();
  for (const [path, entry] of Object.entries(parsed.packages)) {
    if (path === '') {
      continue;
    }
    const name = packageNameFromPath(path);
    if (!name || !entry.version) {
      continue;
    }
    // Keep the first version we encounter for a given package name; npm
    // installs may pin a single version at the top level and re-list it
    // under nested paths. The first occurrence is the hoisted one.
    if (!versions.has(name)) {
      versions.set(name, entry.version);
    }
  }
  return versions;
}

export type DetectedLockfile = {
  readonly kind: LockfileKind;
  readonly path: string;
};

// Candidate order mirrors the package-manager detection order in core (T1.7):
// pnpm first, then npm/shrinkwrap, then Yarn.
export const SUPPORTED_LOCKFILES: readonly DetectedLockfile[] = [
  { kind: 'pnpm-lock', path: 'pnpm-lock.yaml' },
  { kind: 'package-lock', path: 'package-lock.json' },
  { kind: 'package-lock', path: 'npm-shrinkwrap.json' },
  { kind: 'yarn-lock', path: 'yarn.lock' },
];

export function parseLockfile(kind: LockfileKind, content: string): LockfilePackages | undefined {
  if (kind === 'package-lock') {
    return parseNpmLockfile(content);
  }
  if (kind === 'pnpm-lock') {
    return parsePnpmLockfile(content);
  }
  return parseYarnLockfile(content);
}

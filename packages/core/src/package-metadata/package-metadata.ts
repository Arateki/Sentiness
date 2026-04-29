import { join } from 'node:path';
import type { FileSystem } from '@sentiness/check-sdk';
import { z } from 'zod';

export type PackageManager = 'pnpm' | 'npm' | 'yarn' | 'unknown';

export type LockfileInfo = {
  readonly path: string;
  readonly kind: 'pnpm-lock' | 'package-lock' | 'yarn-lock' | 'npm-shrinkwrap';
};

export type PackageMetadata = {
  readonly packageJsonPath: string | null;
  readonly packageManager: PackageManager;
  readonly lockfiles: readonly LockfileInfo[];
  readonly dependencies: Readonly<Record<string, string>>;
  readonly devDependencies: Readonly<Record<string, string>>;
  readonly optionalDependencies: Readonly<Record<string, string>>;
};

export class PackageMetadataError extends Error {
  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options);
    this.name = 'PackageMetadataError';
  }
}

const DependencyRecordSchema = z.record(z.string(), z.string()).optional();
const PackageJsonSchema = z.object({
  packageManager: z.string().optional(),
  dependencies: DependencyRecordSchema,
  devDependencies: DependencyRecordSchema,
  optionalDependencies: DependencyRecordSchema,
});

const lockfileCandidates: readonly LockfileInfo[] = [
  { path: 'pnpm-lock.yaml', kind: 'pnpm-lock' },
  { path: 'package-lock.json', kind: 'package-lock' },
  { path: 'npm-shrinkwrap.json', kind: 'npm-shrinkwrap' },
  { path: 'yarn.lock', kind: 'yarn-lock' },
];

function packageManagerFromField(value: string | undefined): PackageManager {
  if (value?.startsWith('pnpm@')) {
    return 'pnpm';
  }
  if (value?.startsWith('npm@')) {
    return 'npm';
  }
  if (value?.startsWith('yarn@')) {
    return 'yarn';
  }
  return 'unknown';
}

function packageManagerFromLockfiles(lockfiles: readonly LockfileInfo[]): PackageManager {
  if (lockfiles.some((lockfile) => lockfile.kind === 'pnpm-lock')) {
    return 'pnpm';
  }
  if (
    lockfiles.some(
      (lockfile) => lockfile.kind === 'package-lock' || lockfile.kind === 'npm-shrinkwrap',
    )
  ) {
    return 'npm';
  }
  if (lockfiles.some((lockfile) => lockfile.kind === 'yarn-lock')) {
    return 'yarn';
  }
  return 'unknown';
}

export async function detectPackageMetadata(cwd: string, fs: FileSystem): Promise<PackageMetadata> {
  const lockfiles: LockfileInfo[] = [];
  for (const candidate of lockfileCandidates) {
    if (await fs.exists(join(cwd, candidate.path))) {
      lockfiles.push(candidate);
    }
  }

  const packageJsonPath = join(cwd, 'package.json');
  if (!(await fs.exists(packageJsonPath))) {
    return {
      packageJsonPath: null,
      packageManager: packageManagerFromLockfiles(lockfiles),
      lockfiles,
      dependencies: {},
      devDependencies: {},
      optionalDependencies: {},
    };
  }

  try {
    const parsed = PackageJsonSchema.parse(JSON.parse(await fs.readFile(packageJsonPath)));
    const lockfileManager = packageManagerFromLockfiles(lockfiles);
    const fieldManager = packageManagerFromField(parsed.packageManager);
    return {
      packageJsonPath,
      packageManager: lockfileManager === 'unknown' ? fieldManager : lockfileManager,
      lockfiles,
      dependencies: parsed.dependencies ?? {},
      devDependencies: parsed.devDependencies ?? {},
      optionalDependencies: parsed.optionalDependencies ?? {},
    };
  } catch (error) {
    throw new PackageMetadataError(`Failed to read package metadata from ${packageJsonPath}`, {
      cause: error,
    });
  }
}

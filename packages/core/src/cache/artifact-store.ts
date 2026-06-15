import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import type { FileSystem, Logger, ProcessRunner } from '@sentiness/check-sdk';
import type { ArtifactRef, CachePaths } from './paths.js';

const MARKER = '.sentiness-materialized';

export class ArtifactFetchError extends Error {
  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options);
    this.name = 'ArtifactFetchError';
  }
}

export interface MaterializeOptions {
  readonly packageName: string;
  readonly extraInstalls?: readonly string[];
  readonly signal?: AbortSignal;
}

export interface MaterializeResult {
  readonly path: string;
  readonly integrity: string;
}

export interface ArtifactStore {
  slotPath(ref: ArtifactRef): string;
  isMaterialized(ref: ArtifactRef): Promise<boolean>;
  materialize(ref: ArtifactRef, options: MaterializeOptions): Promise<MaterializeResult>;
}

export interface ArtifactStoreDeps {
  readonly paths: CachePaths;
  readonly fs: FileSystem;
  readonly process: ProcessRunner;
  readonly logger: Logger;
  readonly randomId?: () => string;
}

async function readIntegrity(fs: FileSystem, root: string, packageName: string): Promise<string> {
  // Best-effort: npm writes node_modules/.package-lock.json with resolved integrity.
  const lockPath = join(root, 'node_modules', '.package-lock.json');
  if (!(await fs.exists(lockPath))) {
    return '';
  }
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(lockPath));
    const packages =
      (parsed as { packages?: Record<string, { integrity?: string }> }).packages ?? {};
    return packages[`node_modules/${packageName}`]?.integrity ?? '';
  } catch {
    return '';
  }
}

export function createArtifactStore(deps: ArtifactStoreDeps): ArtifactStore {
  const { paths, fs, process, logger } = deps;
  const randomId = deps.randomId ?? randomUUID;

  async function isMaterialized(ref: ArtifactRef): Promise<boolean> {
    return fs.exists(join(paths.slotPath(ref), MARKER));
  }

  return {
    slotPath: (ref) => paths.slotPath(ref),
    isMaterialized,
    async materialize(ref, options) {
      const slot = paths.slotPath(ref);
      if (await isMaterialized(ref)) {
        return { path: slot, integrity: ref.integrity ?? '' };
      }
      const tmp = join(paths.tmpDir(), randomId());
      await fs.mkdir(tmp, { recursive: true });
      await fs.writeFile(join(tmp, 'package.json'), JSON.stringify({ private: true }));

      const specs = [`${options.packageName}@${ref.version}`, ...(options.extraInstalls ?? [])];
      const result = await process.execFile(
        'npm',
        ['install', '--prefix', tmp, '--no-save', '--no-audit', '--no-fund', ...specs],
        options.signal ? { signal: options.signal } : {},
      );
      if (result.exitCode !== 0) {
        await fs.rm(tmp, { recursive: true, force: true });
        throw new ArtifactFetchError(
          `npm install failed for ${specs.join(' ')}: ${result.stderr.trim()}`,
        );
      }

      const integrity = await readIntegrity(fs, tmp, options.packageName);
      if (ref.integrity && integrity && ref.integrity !== integrity) {
        await fs.rm(tmp, { recursive: true, force: true });
        throw new ArtifactFetchError(
          `integrity mismatch for ${options.packageName}@${ref.version}`,
        );
      }

      await fs.writeFile(join(tmp, MARKER), new Date().toISOString());
      await fs.mkdir(dirname(slot), { recursive: true });
      if (await isMaterialized(ref)) {
        // Lost a concurrent race; discard our temp copy.
        await fs.rm(tmp, { recursive: true, force: true });
        return { path: slot, integrity: ref.integrity ?? integrity };
      }
      await fs.rename(tmp, slot);
      logger.debug('materialized artifact', {
        slot,
        package: options.packageName,
        version: ref.version,
      });
      return { path: slot, integrity };
    },
  };
}

import { join } from 'node:path';

export type ArtifactKind = 'engine' | 'check';

export interface ArtifactRef {
  readonly kind: ArtifactKind;
  readonly id: string; // 'core' for the engine; the check id otherwise
  readonly version: string; // exact
  readonly integrity?: string;
}

export interface CachePaths {
  readonly root: string;
  slotPath(ref: ArtifactRef): string;
  tmpDir(): string;
}

export function createCachePaths(cacheRoot: string): CachePaths {
  const cache = join(cacheRoot, 'cache');
  return {
    root: cacheRoot,
    slotPath(ref) {
      return ref.kind === 'engine'
        ? join(cache, 'engine', ref.version)
        : join(cache, 'checks', ref.id, ref.version);
    },
    tmpDir() {
      return join(cache, 'tmp');
    },
  };
}

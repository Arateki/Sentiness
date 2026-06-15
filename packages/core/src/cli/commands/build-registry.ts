import { join } from 'node:path';
import { createArtifactStore } from '../../cache/artifact-store.js';
import { createCachePaths } from '../../cache/paths.js';
import type { ResolvedConfig } from '../../config/config.js';
import { LockManager } from '../../lock/lock.js';
import type { SentinessLock } from '../../lock/schema.js';
import { CheckRegistry } from '../../registry/registry.js';
import type { CommandDeps } from './types.js';

const EMPTY_LOCK: SentinessLock = { lockfileVersion: 1, engine: { version: '' }, checks: {} };

// Builds a CheckRegistry from the resolved config by resolving each check from
// the cache slot (versioned entries) or a local package (path-linked entries).
// The cache root comes from CommandDeps, which the launcher fills via
// --cache-root; path-linked checks never touch the cache.
export async function buildRegistry(
  config: ResolvedConfig,
  deps: CommandDeps,
): Promise<CheckRegistry> {
  const store = createArtifactStore({
    paths: createCachePaths(deps.cacheRoot),
    fs: deps.fs,
    process: deps.processRunner,
    logger: deps.logger,
  });
  const lock = (await LockManager.load(join(deps.cwd, 'sentiness.lock'), deps.fs)) ?? EMPTY_LOCK;
  return CheckRegistry.fromResolved(config, lock, store, deps.cwd);
}

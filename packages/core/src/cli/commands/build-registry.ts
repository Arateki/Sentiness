import { homedir } from 'node:os';
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
// the cache (versioned entries) or a local package (path-linked entries). The
// cache root falls back to ~/.sentiness until the launcher threads --cache-root
// through CommandDeps (Task 6); path-linked checks never touch the cache, so the
// V1 dogfood is unaffected by the fallback.
export async function buildRegistry(
  config: ResolvedConfig,
  deps: CommandDeps,
): Promise<CheckRegistry> {
  const store = createArtifactStore({
    paths: createCachePaths(join(homedir(), '.sentiness')),
    fs: deps.fs,
    process: deps.processRunner,
    logger: deps.logger,
  });
  const lock = (await LockManager.load(join(deps.cwd, 'sentiness.lock'), deps.fs)) ?? EMPTY_LOCK;
  return CheckRegistry.fromResolved(config, lock, store, deps.cwd);
}

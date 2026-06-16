import { join } from 'node:path';
import { type ArtifactStore, createArtifactStore } from '../../cache/artifact-store.js';
import { createCachePaths } from '../../cache/paths.js';
import { loadConfig, type ResolvedConfig } from '../../config/config.js';
import { LockManager } from '../../lock/lock.js';
import type { LockCheck, SentinessLock } from '../../lock/schema.js';
import { EXTERNAL_TOOL_PACKAGES } from './init-plan.js';
import type { CommandDeps } from './types.js';

export interface InstallOptions {
  readonly frozen: boolean;
  readonly signal?: AbortSignal;
}

async function npmResolveVersion(deps: CommandDeps, pkg: string, range: string): Promise<string> {
  const result = await deps.processRunner.execFile('npm', [
    'view',
    `${pkg}@${range}`,
    'version',
    '--json',
  ]);
  if (result.exitCode !== 0) {
    throw new Error(`npm view failed for ${pkg}@${range}: ${result.stderr.trim()}`);
  }
  const parsed: unknown = JSON.parse(result.stdout);
  // npm returns a string for one match, or an array (ascending) for several.
  if (typeof parsed === 'string') {
    return parsed;
  }
  if (Array.isArray(parsed) && parsed.length > 0) {
    const last = parsed.at(-1);
    if (typeof last === 'string') {
      return last;
    }
  }
  throw new Error(`Could not resolve a version for ${pkg}@${range}`);
}

function toolInstalls(id: string, toolVersion: string | undefined): readonly string[] {
  const tool = EXTERNAL_TOOL_PACKAGES[id];
  if (!tool || toolVersion === undefined) {
    return [];
  }
  return [`${tool}@${toolVersion}`];
}

async function materializeAll(
  lock: SentinessLock,
  config: ResolvedConfig,
  store: ArtifactStore,
  signal: AbortSignal | undefined,
): Promise<void> {
  await store.materialize(
    { kind: 'engine', id: 'core', version: lock.engine.version },
    { packageName: '@sentiness/core', ...(signal ? { signal } : {}) },
  );
  for (const [id, entry] of Object.entries(config.checks)) {
    if (entry.path !== undefined) {
      continue;
    }
    const locked = lock.checks[id];
    if (!locked?.version) {
      continue;
    }
    const extraInstalls = toolInstalls(id, entry.toolVersion);
    await store.materialize(
      { kind: 'check', id, version: locked.version },
      {
        packageName: `@sentiness/check-${id}`,
        ...(extraInstalls.length > 0 ? { extraInstalls } : {}),
        ...(signal ? { signal } : {}),
      },
    );
  }
}

export async function installCommand(options: InstallOptions, deps: CommandDeps): Promise<number> {
  const config: ResolvedConfig = await loadConfig(deps.cwd, deps.fs);
  const lockPath = join(deps.cwd, 'sentiness.lock');
  const store = createArtifactStore({
    paths: createCachePaths(deps.cacheRoot),
    fs: deps.fs,
    process: deps.processRunner,
    logger: deps.logger,
  });

  if (options.frozen) {
    const existing = await LockManager.load(lockPath, deps.fs);
    if (!existing) {
      deps.logger.error('sentiness.lock not found — run `sentiness install` to create it');
      return 3;
    }
    const verdict = LockManager.satisfies(existing, config);
    if (!verdict.ok) {
      deps.logger.error(
        `sentiness.lock does not satisfy the config:\n- ${verdict.reasons.join('\n- ')}`,
      );
      return 3;
    }
    await materializeAll(existing, config, store, options.signal);
    deps.stdout.write(`${JSON.stringify({ installed: true, frozen: true })}\n`);
    return 0;
  }

  const engineVersion = await npmResolveVersion(deps, '@sentiness/core', config.engine);
  const engineResult = await store.materialize(
    { kind: 'engine', id: 'core', version: engineVersion },
    { packageName: '@sentiness/core', ...(options.signal ? { signal: options.signal } : {}) },
  );

  const checks: Record<string, LockCheck> = {};
  for (const [id, entry] of Object.entries(config.checks)) {
    if (entry.path !== undefined) {
      checks[id] = { path: entry.path };
      continue;
    }
    const version = await npmResolveVersion(deps, `@sentiness/check-${id}`, entry.version ?? '*');
    const extraInstalls = toolInstalls(id, entry.toolVersion);
    const result = await store.materialize(
      { kind: 'check', id, version },
      {
        packageName: `@sentiness/check-${id}`,
        ...(extraInstalls.length > 0 ? { extraInstalls } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
      },
    );
    checks[id] = { version, ...(result.integrity ? { integrity: result.integrity } : {}) };
  }

  const lock: SentinessLock = {
    lockfileVersion: 1,
    engine: {
      version: engineVersion,
      ...(engineResult.integrity ? { integrity: engineResult.integrity } : {}),
    },
    checks,
  };
  await LockManager.save(lockPath, lock, deps.fs);
  deps.stdout.write(`${JSON.stringify({ installed: true, engine: engineVersion })}\n`);
  return 0;
}

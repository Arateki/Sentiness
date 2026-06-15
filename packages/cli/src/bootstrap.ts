import { join } from 'node:path';
import type { FileSystem, Logger, ProcessRunner } from '@sentiness/check-sdk';

export interface LauncherDeps {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly fs: FileSystem;
  readonly process: ProcessRunner;
  readonly logger: Logger;
  readonly stdout: { write(text: string): void };
  readonly stderr: { write(text: string): void };
}

const MARKER = '.sentiness-materialized';

function cacheRootFrom(env: Readonly<Record<string, string>>): string {
  return env.SENTINESS_HOME ?? join(env.HOME ?? env.USERPROFILE ?? '.', '.sentiness');
}

async function readJson(
  fs: FileSystem,
  path: string,
): Promise<Record<string, unknown> | undefined> {
  if (!(await fs.exists(path))) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(path));
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

async function fetchEngine(deps: LauncherDeps, slot: string, version: string): Promise<number> {
  await deps.fs.mkdir(slot, { recursive: true });
  await deps.fs.writeFile(join(slot, 'package.json'), JSON.stringify({ private: true }));
  const result = await deps.process.execFile('npm', [
    'install',
    '--prefix',
    slot,
    '--no-save',
    '--no-audit',
    '--no-fund',
    `@sentiness/core@${version}`,
  ]);
  if (result.exitCode !== 0) {
    deps.stderr.write(`Failed to fetch @sentiness/core@${version}: ${result.stderr.trim()}\n`);
    return 3;
  }
  await deps.fs.writeFile(join(slot, MARKER), new Date().toISOString());
  return 0;
}

async function spawnEngine(
  deps: LauncherDeps,
  engineEntry: string,
  cacheRoot: string,
  argv: readonly string[],
): Promise<number> {
  const result = await deps.process.execFile(
    'node',
    [engineEntry, '--cache-root', cacheRoot, ...argv],
    {
      cwd: deps.cwd,
    },
  );
  if (result.stdout.length > 0) {
    deps.stdout.write(result.stdout);
  }
  if (result.stderr.length > 0) {
    deps.stderr.write(result.stderr);
  }
  return result.exitCode;
}

export async function run(argv: readonly string[], deps: LauncherDeps): Promise<number> {
  // Dev bypass: a local engine checkout.
  const enginePathOverride = deps.env.SENTINESS_ENGINE_PATH;

  const config =
    (await readJson(deps.fs, join(deps.cwd, 'sentiness.config.json'))) ??
    (await readJson(deps.fs, join(deps.cwd, 'sentiness.config.js')));
  if (!config && !enginePathOverride) {
    deps.stderr.write('No sentiness.config.json found. Run `sentiness init` first.\n');
    return 3;
  }

  const cacheRoot = cacheRootFrom(deps.env);

  if (enginePathOverride) {
    return spawnEngine(deps, join(enginePathOverride, 'dist', 'cli', 'index.js'), cacheRoot, argv);
  }

  const lock = await readJson(deps.fs, join(deps.cwd, 'sentiness.lock'));
  const engineVersion = (lock?.engine as { version?: string } | undefined)?.version;
  if (!engineVersion) {
    deps.stderr.write(
      'sentiness.lock is missing or has no engine version. Run `sentiness install`.\n',
    );
    return 3;
  }

  const engineSlot = join(cacheRoot, 'cache', 'engine', engineVersion);
  if (!(await deps.fs.exists(join(engineSlot, MARKER)))) {
    const fetched = await fetchEngine(deps, engineSlot, engineVersion);
    if (fetched !== 0) {
      return fetched;
    }
  }
  return spawnEngine(
    deps,
    join(engineSlot, 'node_modules', '@sentiness', 'core', 'dist', 'cli', 'index.js'),
    cacheRoot,
    argv,
  );
}

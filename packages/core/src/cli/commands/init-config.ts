import { dirname, isAbsolute, join } from 'node:path';
import type { Check, DefaultConfigContext, FileSystem } from '@sentiness/check-sdk';
import { loadConfig } from '../../config/config.js';
import { buildRegistry } from './build-registry.js';
import type { CommandDeps, ParsedArgs } from './types.js';

type WriteOutcome = {
  readonly checkId: string;
  readonly action: 'created' | 'skipped-existing' | 'skipped-no-default' | 'skipped-no-files';
  readonly path?: string;
  readonly existing?: string;
};

async function findExistingConfig(
  check: Check,
  cwd: string,
  fs: FileSystem,
): Promise<string | undefined> {
  for (const candidate of check.configFiles ?? []) {
    const path = isAbsolute(candidate) ? candidate : join(cwd, candidate);
    if (await fs.exists(path)) {
      return candidate;
    }
  }
  return undefined;
}

async function maybeWriteDefault(
  check: Check,
  cwd: string,
  fs: FileSystem,
  force: boolean,
  context: DefaultConfigContext,
): Promise<WriteOutcome> {
  if (!check.configFiles || check.configFiles.length === 0) {
    return { checkId: check.id, action: 'skipped-no-files' };
  }
  if (!check.defaultConfig) {
    return { checkId: check.id, action: 'skipped-no-default' };
  }
  const existing = await findExistingConfig(check, cwd, fs);
  if (existing && !force) {
    return { checkId: check.id, action: 'skipped-existing', existing };
  }
  const template = check.defaultConfig(context);
  const target = isAbsolute(template.path) ? template.path : join(cwd, template.path);
  await fs.mkdir(dirname(target), { recursive: true });
  await fs.writeFile(target, template.content);
  return { checkId: check.id, action: 'created', path: template.path };
}

export async function initConfigCommand(args: ParsedArgs, deps: CommandDeps): Promise<number> {
  const config = await loadConfig(deps.cwd, deps.fs);
  const registry = await buildRegistry(config, deps);
  const force = args.force === true;
  const requestedId = typeof args.check === 'string' ? args.check : undefined;
  const candidates = requestedId
    ? registry.list().filter((check) => check.id === requestedId)
    : registry.list();

  if (requestedId && candidates.length === 0) {
    deps.logger.error(
      `No enabled check found with id "${requestedId}". Run sentiness doctor to see available checks.`,
    );
    return 1;
  }

  const context: DefaultConfigContext = {
    enabledCheckIds: registry.list().map((check) => check.id),
  };
  const outcomes: WriteOutcome[] = [];
  for (const check of candidates) {
    outcomes.push(await maybeWriteDefault(check, deps.cwd, deps.fs, force, context));
  }

  deps.stdout.write(`${JSON.stringify({ outcomes }, null, 2)}\n`);
  const created = outcomes.filter((outcome) => outcome.action === 'created');
  for (const outcome of created) {
    deps.logger.info(`Created default config for ${outcome.checkId} at ${outcome.path}`);
  }
  return 0;
}

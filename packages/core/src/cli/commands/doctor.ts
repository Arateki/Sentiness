import { loadConfig } from '../../config/config.js';
import { CheckRegistry } from '../../registry/registry.js';
import type { CommandDeps, ParsedArgs } from './types.js';

export async function doctorCommand(_args: ParsedArgs, deps: CommandDeps): Promise<number> {
  const config = await loadConfig(deps.cwd, deps.fs);
  const registry = await CheckRegistry.fromConfig(config, deps.cwd);
  const checks = registry.list().map((check) => ({
    id: check.id,
    category: check.category,
    defaultTier: check.defaultTier,
  }));
  deps.stdout.write(
    `${JSON.stringify(
      {
        ok: registry.loadFailures().length === 0,
        checks,
        loadFailures: registry.loadFailures(),
      },
      null,
      2,
    )}\n`,
  );
  return registry.loadFailures().length === 0 ? 0 : 1;
}

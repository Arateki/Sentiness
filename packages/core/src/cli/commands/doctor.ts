import { loadConfig } from '../../config/config.js';
import { CheckRegistry } from '../../registry/registry.js';
import type { CommandDeps, ParsedArgs } from './types.js';

function installSuggestion(checkId: string): string | undefined {
  const packages: Readonly<Record<string, string>> = {
    biome: '@biomejs/biome',
    knip: 'knip',
    stryker: '@stryker-mutator/core',
  };
  const packageName = packages[checkId];
  return packageName ? `pnpm add -D ${packageName}` : undefined;
}

export async function doctorCommand(_args: ParsedArgs, deps: CommandDeps): Promise<number> {
  const config = await loadConfig(deps.cwd, deps.fs);
  const registry = await CheckRegistry.fromConfig(config, deps.cwd);
  const checks = await Promise.all(
    registry.list().map(async (check) => {
      const controller = new AbortController();
      const checkConfig = config.checks[check.id] ?? { enabled: true };
      try {
        const detect = await check.detect({
          cwd: deps.cwd,
          tier: checkConfig.tier ?? check.defaultTier,
          trigger: null,
          baseRef: null,
          changedFiles: [],
          diffOnly: false,
          signal: controller.signal,
          logger: deps.logger,
          fs: deps.fs,
          process: deps.processRunner,
          checkConfig,
        });
        return {
          id: check.id,
          category: check.category,
          defaultTier: check.defaultTier,
          available: detect.available,
          ...(detect.reason ? { reason: detect.reason } : {}),
          ...(detect.version ? { version: detect.version } : {}),
          ...(!detect.available && installSuggestion(check.id)
            ? { suggestion: installSuggestion(check.id) }
            : {}),
        };
      } catch (error) {
        return {
          id: check.id,
          category: check.category,
          defaultTier: check.defaultTier,
          available: false,
          reason: error instanceof Error ? error.message : 'check detection failed',
          ...(installSuggestion(check.id) ? { suggestion: installSuggestion(check.id) } : {}),
        };
      }
    }),
  );
  const ok = registry.loadFailures().length === 0 && checks.every((check) => check.available);
  deps.stdout.write(
    `${JSON.stringify(
      {
        ok,
        checks,
        loadFailures: registry.loadFailures(),
      },
      null,
      2,
    )}\n`,
  );
  return ok ? 0 : 1;
}

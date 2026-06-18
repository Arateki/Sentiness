import { isAbsolute, join } from 'node:path';
import type { Check, FileSystem } from '@sentiness/check-sdk';
import { loadConfig } from '../../config/config.js';
import { buildRegistry } from './build-registry.js';
import type { CommandDeps, ParsedArgs } from './types.js';

function installSuggestion(checkId: string): string | undefined {
  const suggestions: Readonly<Record<string, string>> = {
    biome: 'pnpm add -D @biomejs/biome',
    'dependency-cruiser': 'pnpm add -D dependency-cruiser',
    jscpd: 'pnpm add -D jscpd',
    knip: 'pnpm add -D knip',
    'lockfile-lint': 'pnpm add -D lockfile-lint',
    'osv-scanner': 'install osv-scanner from https://google.github.io/osv-scanner/installation/',
    playwright: 'pnpm add -D @playwright/test',
    semgrep: 'install semgrep from https://semgrep.dev/docs/getting-started/cli/',
    stryker: 'pnpm add -D @stryker-mutator/core',
  };
  return suggestions[checkId];
}

type ConfigStatus = {
  readonly configured: boolean;
  readonly optional: boolean;
  readonly expectedFiles: readonly string[];
  readonly foundFile?: string;
  readonly canCreateDefault: boolean;
};

async function inspectConfig(check: Check, cwd: string, fs: FileSystem): Promise<ConfigStatus> {
  const expected = check.configFiles ?? [];
  const optional = check.configOptional === true;
  if (expected.length === 0) {
    return { configured: true, optional, expectedFiles: [], canCreateDefault: false };
  }
  for (const candidate of expected) {
    const path = isAbsolute(candidate) ? candidate : join(cwd, candidate);
    if (await fs.exists(path)) {
      return {
        configured: true,
        optional,
        expectedFiles: expected,
        foundFile: candidate,
        canCreateDefault: check.defaultConfig !== undefined,
      };
    }
  }
  return {
    configured: false,
    optional,
    expectedFiles: expected,
    canCreateDefault: check.defaultConfig !== undefined,
  };
}

export async function doctorCommand(_args: ParsedArgs, deps: CommandDeps): Promise<number> {
  const config = await loadConfig(deps.cwd, deps.fs);
  const registry = await buildRegistry(config, deps);
  const checks = await Promise.all(
    registry.list().map(async (check) => {
      const controller = new AbortController();
      const checkConfig = config.checks[check.id] ?? { enabled: true };
      const configStatus = await inspectConfig(check, deps.cwd, deps.fs);
      const configBlock = configStatus.expectedFiles.length > 0 ? { config: configStatus } : {};
      const initSuggestion =
        !configStatus.configured && configStatus.canCreateDefault
          ? { configSuggestion: `sentiness init-config --check=${check.id}` }
          : {};
      try {
        const detect = await check.detect({
          cwd: deps.cwd,
          repoRoot: deps.cwd,
          tier: checkConfig.tier ?? check.defaultTier,
          trigger: null,
          baseRef: null,
          changedFiles: [],
          changedRanges: new Map(),
          diffOnly: false,
          signal: controller.signal,
          logger: deps.logger,
          fs: deps.fs,
          git: deps.git,
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
          ...configBlock,
          ...initSuggestion,
        };
      } catch (error) {
        return {
          id: check.id,
          category: check.category,
          defaultTier: check.defaultTier,
          available: false,
          reason: error instanceof Error ? error.message : 'check detection failed',
          ...(installSuggestion(check.id) ? { suggestion: installSuggestion(check.id) } : {}),
          ...configBlock,
          ...initSuggestion,
        };
      }
    }),
  );
  const ok =
    registry.loadFailures().length === 0 &&
    checks.every(
      (check) =>
        check.available &&
        ((check.config?.configured ?? true) || (check.config?.optional ?? false)),
    );
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

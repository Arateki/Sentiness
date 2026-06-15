import { join } from 'node:path';
import type { FileSystem } from '@sentiness/check-sdk';
import {
  detectPackageMetadata,
  type PackageManager,
  type PackageMetadata,
} from '../../package-metadata/package-metadata.js';

export type TestRunner = 'vitest' | 'jest' | 'none';

export type CheckRecommendation = {
  readonly id: string;
  readonly label: string;
  readonly tier: 'fast' | 'standard' | 'slow';
  readonly recommended: boolean;
};

export type OnboardingPlan = {
  readonly packageManager: PackageManager;
  readonly hasTypescript: boolean;
  readonly testRunner: TestRunner;
  readonly checks: readonly CheckRecommendation[];
  readonly detectedAgents: readonly string[];
  readonly installedDependencies: ReadonlySet<string>;
};

// npm-installable external tool per check; checks absent here either need no
// tool (coverage, deps-diff) or are not installable from npm (osv-scanner,
// semgrep — doctor prints their install hints).
export const EXTERNAL_TOOL_PACKAGES: Readonly<Record<string, string>> = {
  biome: '@biomejs/biome',
  eslint: 'eslint',
  knip: 'knip',
  stryker: '@stryker-mutator/core',
  'dependency-cruiser': 'dependency-cruiser',
  'lockfile-lint': 'lockfile-lint',
  jscpd: 'jscpd',
  playwright: '@playwright/test',
};

const PLAYWRIGHT_CONFIG_FILES = [
  'playwright.config.ts',
  'playwright.config.js',
  'playwright.config.mjs',
  'playwright.config.cjs',
] as const;

const ESLINT_CONFIG_FILES = [
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
  'eslint.config.ts',
  'eslint.config.mts',
  'eslint.config.cts',
] as const;

function dependencyNames(metadata: PackageMetadata): ReadonlySet<string> {
  return new Set([
    ...Object.keys(metadata.dependencies),
    ...Object.keys(metadata.devDependencies),
    ...Object.keys(metadata.optionalDependencies),
  ]);
}

async function anyExists(
  cwd: string,
  fs: FileSystem,
  candidates: readonly string[],
): Promise<boolean> {
  for (const candidate of candidates) {
    if (await fs.exists(join(cwd, candidate))) {
      return true;
    }
  }
  return false;
}

export async function buildOnboardingPlan(cwd: string, fs: FileSystem): Promise<OnboardingPlan> {
  const metadata = await detectPackageMetadata(cwd, fs);
  const installed = dependencyNames(metadata);
  const hasTypescript = installed.has('typescript');
  const testRunner: TestRunner = installed.has('vitest')
    ? 'vitest'
    : installed.has('jest')
      ? 'jest'
      : 'none';
  const hasTestRunner = testRunner !== 'none';
  const hasBiomeConfig = await anyExists(cwd, fs, ['biome.json', 'biome.jsonc']);
  const hasOtherLinter = installed.has('eslint');
  const hasEslint = hasOtherLinter || (await anyExists(cwd, fs, ESLINT_CONFIG_FILES));
  const hasPlaywright =
    installed.has('@playwright/test') ||
    installed.has('playwright') ||
    (await anyExists(cwd, fs, PLAYWRIGHT_CONFIG_FILES));

  const checks: readonly CheckRecommendation[] = [
    {
      id: 'biome',
      label: 'Biome check (fast lint & format)',
      tier: 'fast',
      recommended: hasBiomeConfig || !hasOtherLinter,
    },
    {
      id: 'eslint',
      label: 'ESLint check (ecosystems Biome cannot fully lint, e.g. Vue SFCs)',
      tier: 'standard',
      recommended: hasEslint,
    },
    {
      id: 'knip',
      label: 'Knip check (unused code/dependencies)',
      tier: 'standard',
      recommended: true,
    },
    {
      id: 'coverage',
      label: 'Coverage check (Istanbul coverage report)',
      tier: 'slow',
      recommended: hasTestRunner,
    },
    {
      id: 'stryker',
      label: 'Stryker check (mutation testing)',
      tier: 'slow',
      recommended: hasTestRunner,
    },
    {
      id: 'deps-diff',
      label: 'Dependency diff check (package.json & lockfile changes)',
      tier: 'fast',
      recommended: true,
    },
    {
      id: 'dependency-cruiser',
      label: 'Dependency Cruiser check (architecture rules)',
      tier: 'standard',
      recommended: false,
    },
    {
      id: 'lockfile-lint',
      label: 'Lockfile Lint check (lockfile security policy)',
      tier: 'standard',
      recommended: false,
    },
    {
      id: 'jscpd',
      label: 'jscpd check (code duplication)',
      tier: 'standard',
      recommended: false,
    },
    {
      id: 'osv-scanner',
      label: 'OSV Scanner check (dependency vulnerabilities)',
      tier: 'slow',
      recommended: false,
    },
    {
      id: 'semgrep',
      label: 'Semgrep check (security rules)',
      tier: 'slow',
      recommended: false,
    },
    {
      id: 'playwright',
      label: 'Playwright check (E2E tests with visual feedback)',
      tier: 'slow',
      recommended: hasPlaywright,
    },
  ];

  // Skill adapters are preferred over managed sections: agents load skills on
  // demand instead of carrying the full instructions in every session.
  const detectedAgents: string[] = [];
  if ((await fs.exists(join(cwd, '.claude'))) || (await fs.exists(join(cwd, 'CLAUDE.md')))) {
    detectedAgents.push('claude-code-skill');
  }
  if ((await fs.exists(join(cwd, '.agents'))) || (await fs.exists(join(cwd, 'AGENTS.md')))) {
    detectedAgents.push('codex-skill');
  }
  if (await fs.exists(join(cwd, 'GEMINI.md'))) {
    detectedAgents.push('gemini');
  }

  return {
    packageManager: metadata.packageManager,
    hasTypescript,
    testRunner,
    checks,
    detectedAgents,
    installedDependencies: installed,
  };
}

export function missingPackagesFor(
  enabledCheckIds: readonly string[],
  installed: ReadonlySet<string>,
): readonly string[] {
  const missing: string[] = [];
  for (const id of enabledCheckIds) {
    const checkPackage = `@sentiness/check-${id}`;
    if (!installed.has(checkPackage)) {
      missing.push(checkPackage);
    }
    const tool = EXTERNAL_TOOL_PACKAGES[id];
    if (tool && !installed.has(tool)) {
      missing.push(tool);
    }
  }
  return missing;
}

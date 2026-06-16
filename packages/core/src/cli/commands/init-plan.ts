import { join, relative } from 'node:path';
import type { FileSystem } from '@sentiness/check-sdk';
import {
  detectPackageMetadata,
  type PackageManager,
  type PackageMetadata,
} from '../../package-metadata/package-metadata.js';
import { SENTINESS_VERSION } from '../../version.js';

export type TestRunner = 'vitest' | 'jest' | 'none';

export type Ecosystem = 'node' | 'rust' | 'go' | 'unknown';

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
};

// npm-installable external tool per check; checks absent here either need no
// tool (coverage, deps-diff) or are not installable from npm (osv-scanner,
// semgrep — doctor prints their install hints). Consumed by `sentiness install`
// to pin each check's tool alongside the check package.
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
  };
}

export type DetectedZone = {
  readonly path: string; // project-relative, '.' for the root zone
  readonly ecosystem: Ecosystem;
  readonly recommendedCheckIds: readonly string[];
};

export type OnboardingPlanV2 = {
  readonly engineVersion: string; // the CLI's own version, pinned into config
  readonly zones: readonly DetectedZone[]; // [{ path: '.', … }] for single-project
  readonly catalog: readonly CheckRecommendation[]; // union of all zones' checks, deduped
  readonly detectedAgents: readonly string[];
};

// The only non-JS check in v2. Rust zones recommend it; it resolves on the host
// PATH (detect-only) once the package ships.
const RUST_CLIPPY_RECOMMENDATION: CheckRecommendation = {
  id: 'clippy',
  label: 'Clippy check (Rust lints)',
  tier: 'standard',
  recommended: true,
};

// Directories that never hold a project we want to zone; skipped while walking.
const IGNORED_WALK_DIRS: ReadonlySet<string> = new Set([
  'node_modules',
  'target',
  'dist',
  'build',
  'out',
  'coverage',
  'vendor',
  '.git',
  '.sentiness',
  '.next',
  '.turbo',
]);

const MAX_ZONE_WALK_DEPTH = 4;

async function ecosystemAt(dir: string, fs: FileSystem): Promise<Ecosystem> {
  // Rust/Go markers win over package.json: a polyglot subdir is labelled by its
  // own toolchain, not by an incidental package.json (e.g. for JS test fixtures).
  if (await fs.exists(join(dir, 'Cargo.toml'))) {
    return 'rust';
  }
  if (await fs.exists(join(dir, 'go.mod'))) {
    return 'go';
  }
  if (await fs.exists(join(dir, 'package.json'))) {
    return 'node';
  }
  return 'unknown';
}

type EcosystemDir = { readonly dir: string; readonly ecosystem: Ecosystem };

// Walk the repo for ecosystem markers. The root is always a candidate zone and
// is always descended into so sibling crates/modules are found. A marked subdir
// becomes its own zone and is not descended into (its subtree belongs to it).
// Nested node packages are folded into the root node zone — JS tooling runs from
// the repo root across the whole tree — so a plain node monorepo stays single-zone.
async function detectEcosystemDirs(cwd: string, fs: FileSystem): Promise<readonly EcosystemDir[]> {
  const found: EcosystemDir[] = [];
  let hasRootNodeZone = false;

  const visit = async (dir: string, depth: number, isRoot: boolean): Promise<void> => {
    const ecosystem = await ecosystemAt(dir, fs);
    if (!isRoot && ecosystem !== 'unknown') {
      if (!(ecosystem === 'node' && hasRootNodeZone)) {
        found.push({ dir, ecosystem });
      }
      return; // do not descend into a marked subdir
    }
    if (isRoot && ecosystem !== 'unknown') {
      found.push({ dir, ecosystem });
      hasRootNodeZone = ecosystem === 'node';
    }
    if (depth >= MAX_ZONE_WALK_DEPTH) {
      return;
    }
    let entries: readonly string[];
    try {
      entries = await fs.readDir(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (name.startsWith('.') || IGNORED_WALK_DIRS.has(name)) {
        continue;
      }
      const child = join(dir, name);
      const stat = await fs.stat(child).catch(() => undefined);
      if (stat?.isDirectory) {
        await visit(child, depth + 1, false);
      }
    }
  };

  await visit(cwd, 0, true);
  return found;
}

function zonePath(cwd: string, dir: string): string {
  const rel = relative(cwd, dir);
  return rel === '' ? '.' : rel.split('\\').join('/');
}

async function recommendationsForZone(
  ecosystem: Ecosystem,
  dir: string,
  fs: FileSystem,
): Promise<readonly CheckRecommendation[]> {
  if (ecosystem === 'node') {
    return (await buildOnboardingPlan(dir, fs)).checks;
  }
  if (ecosystem === 'rust') {
    return [RUST_CLIPPY_RECOMMENDATION];
  }
  return []; // go (and unknown): no checks yet, but the zone is still recorded
}

export async function buildOnboardingPlanV2(
  cwd: string,
  fs: FileSystem,
): Promise<OnboardingPlanV2> {
  const ecosystemDirs = await detectEcosystemDirs(cwd, fs);
  const zones: DetectedZone[] = [];
  const catalog = new Map<string, CheckRecommendation>();

  for (const { dir, ecosystem } of ecosystemDirs) {
    const recommendations = await recommendationsForZone(ecosystem, dir, fs);
    for (const recommendation of recommendations) {
      if (!catalog.has(recommendation.id)) {
        catalog.set(recommendation.id, recommendation);
      }
    }
    zones.push({
      path: zonePath(cwd, dir),
      ecosystem,
      recommendedCheckIds: recommendations.filter((r) => r.recommended).map((r) => r.id),
    });
  }

  const rootPlan = await buildOnboardingPlan(cwd, fs);
  return {
    engineVersion: SENTINESS_VERSION,
    zones,
    catalog: [...catalog.values()],
    detectedAgents: rootPlan.detectedAgents,
  };
}

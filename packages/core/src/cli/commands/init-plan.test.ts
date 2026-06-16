import { InMemoryFileSystem } from '@sentiness/_test-utils';
import { describe, expect, it } from 'vitest';
import {
  buildOnboardingPlan,
  buildOnboardingPlanV2,
  type CheckRecommendation,
  type TestRunner,
} from './init-plan.js';

function fsWith(files: Record<string, string>): InMemoryFileSystem {
  return new InMemoryFileSystem(files);
}

function packageJson(deps: Record<string, string>): string {
  return JSON.stringify({ name: 'target', devDependencies: deps });
}

function recommendedIds(checks: readonly CheckRecommendation[]): readonly string[] {
  return checks.filter((check) => check.recommended).map((check) => check.id);
}

describe('buildOnboardingPlan', () => {
  it('lists all twelve implemented checks', async () => {
    const fs = fsWith({ '/project/package.json': packageJson({}) });
    const plan = await buildOnboardingPlan('/project', fs);

    expect(plan.checks.map((check) => check.id)).toEqual([
      'biome',
      'eslint',
      'knip',
      'coverage',
      'stryker',
      'deps-diff',
      'dependency-cruiser',
      'lockfile-lint',
      'jscpd',
      'osv-scanner',
      'semgrep',
      'playwright',
    ]);
  });

  it('recommends eslint only when an eslint dependency or flat config exists', async () => {
    const none = await buildOnboardingPlan(
      '/project',
      fsWith({ '/project/package.json': packageJson({}) }),
    );
    expect(recommendedIds(none.checks)).not.toContain('eslint');

    const withDep = await buildOnboardingPlan(
      '/project',
      fsWith({ '/project/package.json': packageJson({ eslint: '^9.0.0' }) }),
    );
    expect(recommendedIds(withDep.checks)).toContain('eslint');

    const withConfig = await buildOnboardingPlan(
      '/project',
      fsWith({
        '/project/package.json': packageJson({}),
        '/project/eslint.config.mjs': 'export default [];',
      }),
    );
    expect(recommendedIds(withConfig.checks)).toContain('eslint');
  });

  it('recommends coverage and stryker only when a test runner is present', async () => {
    const bare = await buildOnboardingPlan(
      '/project',
      fsWith({ '/project/package.json': packageJson({}) }),
    );
    expect(recommendedIds(bare.checks)).not.toContain('coverage');
    expect(recommendedIds(bare.checks)).not.toContain('stryker');
    expect(bare.testRunner).toBe('none');

    const withVitest = await buildOnboardingPlan(
      '/project',
      fsWith({ '/project/package.json': packageJson({ vitest: '^3.0.0' }) }),
    );
    expect(recommendedIds(withVitest.checks)).toContain('coverage');
    expect(recommendedIds(withVitest.checks)).toContain('stryker');
    const expectedRunner: TestRunner = 'vitest';
    expect(withVitest.testRunner).toBe(expectedRunner);
  });

  it('recommends playwright when a config file or dependency exists', async () => {
    const none = await buildOnboardingPlan(
      '/project',
      fsWith({ '/project/package.json': packageJson({}) }),
    );
    expect(recommendedIds(none.checks)).not.toContain('playwright');

    const withConfig = await buildOnboardingPlan(
      '/project',
      fsWith({
        '/project/package.json': packageJson({}),
        '/project/playwright.config.ts': 'export default {};',
      }),
    );
    expect(recommendedIds(withConfig.checks)).toContain('playwright');

    const withDep = await buildOnboardingPlan(
      '/project',
      fsWith({ '/project/package.json': packageJson({ '@playwright/test': '^1.44.0' }) }),
    );
    expect(recommendedIds(withDep.checks)).toContain('playwright');
  });

  it('keeps biome recommended unless another linter is present without a biome config', async () => {
    const eslintProject = await buildOnboardingPlan(
      '/project',
      fsWith({ '/project/package.json': packageJson({ eslint: '^9.0.0' }) }),
    );
    expect(recommendedIds(eslintProject.checks)).not.toContain('biome');

    const biomeConfigured = await buildOnboardingPlan(
      '/project',
      fsWith({
        '/project/package.json': packageJson({ eslint: '^9.0.0' }),
        '/project/biome.json': '{}',
      }),
    );
    expect(recommendedIds(biomeConfigured.checks)).toContain('biome');
  });

  it('always recommends deps-diff and knip', async () => {
    const plan = await buildOnboardingPlan(
      '/project',
      fsWith({ '/project/package.json': packageJson({}) }),
    );
    expect(recommendedIds(plan.checks)).toContain('deps-diff');
    expect(recommendedIds(plan.checks)).toContain('knip');
  });

  it('detects agents from instruction files, preferring skill adapters', async () => {
    const plan = await buildOnboardingPlan(
      '/project',
      fsWith({
        '/project/package.json': packageJson({}),
        '/project/CLAUDE.md': '# instructions',
        '/project/AGENTS.md': '# instructions',
      }),
    );
    expect(plan.detectedAgents).toEqual(['claude-code-skill', 'codex-skill']);
  });

  it('detects codex from a repository .agents directory', async () => {
    const plan = await buildOnboardingPlan(
      '/project',
      fsWith({
        '/project/package.json': packageJson({}),
        '/project/.agents/skills/other/SKILL.md': '# some skill',
      }),
    );
    expect(plan.detectedAgents).toEqual(['codex-skill']);
  });
});

describe('buildOnboardingPlanV2', () => {
  it('returns a single root node zone (no extra zones) for a plain node project', async () => {
    const plan = await buildOnboardingPlanV2('/project', fsWith({ '/project/package.json': '{}' }));
    expect(plan.zones).toHaveLength(1);
    expect(plan.zones[0]).toMatchObject({ path: '.', ecosystem: 'node' });
    expect(plan.catalog.map((c) => c.id)).toContain('biome');
    expect(plan.engineVersion.length).toBeGreaterThan(0);
  });

  it('folds nested node packages into the single root node zone', async () => {
    const plan = await buildOnboardingPlanV2(
      '/project',
      fsWith({
        '/project/package.json': '{}',
        '/project/packages/a/package.json': '{}',
        '/project/packages/b/package.json': '{}',
      }),
    );
    expect(plan.zones).toHaveLength(1);
    expect(plan.zones[0]?.path).toBe('.');
  });

  it('records a rust zone alongside the node root for a node+rust monorepo', async () => {
    const plan = await buildOnboardingPlanV2(
      '/project',
      fsWith({
        '/project/package.json': '{}',
        '/project/crates/app/Cargo.toml': '[package]\nname = "app"\n',
      }),
    );
    const byPath = new Map(plan.zones.map((z) => [z.path, z]));
    expect(byPath.get('.')?.ecosystem).toBe('node');
    expect(byPath.get('crates/app')?.ecosystem).toBe('rust');
    expect(byPath.get('crates/app')?.recommendedCheckIds).toEqual(['clippy']);
    expect(plan.catalog.map((c) => c.id)).toContain('clippy');
  });

  it('records a go zone with no checks for a node+go monorepo', async () => {
    const plan = await buildOnboardingPlanV2(
      '/project',
      fsWith({
        '/project/package.json': '{}',
        '/project/services/api/go.mod': 'module api\n',
      }),
    );
    const byPath = new Map(plan.zones.map((z) => [z.path, z]));
    expect(byPath.get('services/api')?.ecosystem).toBe('go');
    expect(byPath.get('services/api')?.recommendedCheckIds).toEqual([]);
  });

  it('ignores markers under vendored directories like node_modules', async () => {
    const plan = await buildOnboardingPlanV2(
      '/project',
      fsWith({
        '/project/package.json': '{}',
        '/project/node_modules/dep/Cargo.toml': '[package]\n',
      }),
    );
    expect(plan.zones).toHaveLength(1);
    expect(plan.zones[0]?.ecosystem).toBe('node');
  });
});

import { InMemoryFileSystem } from '@sentiness/_test-utils';
import { describe, expect, it } from 'vitest';
import { buildOnboardingPlan, type CheckRecommendation, type TestRunner } from './init-plan.js';

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

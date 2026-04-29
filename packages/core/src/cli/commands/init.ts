import { dirname, isAbsolute, join } from 'node:path';
import { detectPackageMetadata } from '../../package-metadata/package-metadata.js';
import { baselineInitCommand } from './baseline.js';
import type { CommandDeps, ParsedArgs } from './types.js';
import { Prompter } from '../wizard/prompts.js';

function resolvePath(cwd: string, path: string): string {
  return isAbsolute(path) ? path : join(cwd, path);
}

export async function initCommand(args: ParsedArgs, deps: CommandDeps): Promise<number> {
  const prompter = new Prompter();

  try {
    deps.logger.info('Welcome to Sentiness Init Wizard!');

    const configPath = resolvePath(deps.cwd, 'sentiness.config.json');
    if (await deps.fs.exists(configPath)) {
      const proceed = await prompter.confirm('sentiness.config.json already exists. Do you want to overwrite it?', false);
      if (!proceed) {
        deps.logger.info('Init aborted.');
        return 0;
      }
    }

    const metadata = await detectPackageMetadata(deps.cwd, deps.fs);
    const hasVitest = 'vitest' in metadata.devDependencies || 'vitest' in metadata.dependencies;
    const hasJest = 'jest' in metadata.devDependencies || 'jest' in metadata.dependencies;
    const hasTs = 'typescript' in metadata.devDependencies || 'typescript' in metadata.dependencies;

    const checks: Record<string, any> = {};

    deps.logger.info(`Detected Package Manager: ${metadata.packageManager}`);
    deps.logger.info(`Detected TypeScript: ${hasTs ? 'yes' : 'no'}`);
    deps.logger.info(`Detected Test Runner: ${hasVitest ? 'vitest' : hasJest ? 'jest' : 'none'}`);

    // Since we are deferring full Phase 5 expansion, we focus on the core implemented checks like Biome
    const useBiome = await prompter.confirm('Enable Biome check (fast lint & format)?', true);
    if (useBiome) {
      checks.biome = { enabled: true, tier: 'fast' };
    }

    const config = {
      schemaVersion: '1.0',
      tiers: {
        fast: { triggers: ['post-edit', 'pre-commit'], timeoutMs: 30000 },
        standard: { triggers: ['pre-done'], timeoutMs: 120000 },
        slow: { triggers: ['pre-push', 'pre-pr', 'manual'], timeoutMs: 600000 },
      },
      checks,
      baseline: { path: '.sentiness/baseline.json' },
      pending: { path: '.sentiness/pending-feedback.json' },
      reporting: { compact: false, omitOk: true, warningsAreErrors: false },
    };

    await deps.fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
    deps.logger.info(`Created ${configPath}`);

    // Create .sentiness directory structure
    const sentinessDir = resolvePath(deps.cwd, '.sentiness');
    await deps.fs.mkdir(join(sentinessDir, 'jobs'), { recursive: true });
    await deps.fs.mkdir(join(sentinessDir, 'cache'), { recursive: true });

    // Update .gitignore
    const gitignorePath = resolvePath(deps.cwd, '.gitignore');
    const ignoreEntries = '\n# Sentiness\n.sentiness/jobs/\n.sentiness/cache/\n.sentiness/pending-feedback.json\n.sentiness/pending-feedback.json.lock/\n';
    if (await deps.fs.exists(gitignorePath)) {
      const current = await deps.fs.readFile(gitignorePath);
      if (!current.includes('.sentiness/jobs/')) {
        await deps.fs.appendFile(gitignorePath, ignoreEntries);
        deps.logger.info('Added .sentiness/ ignores to .gitignore');
      }
    } else {
      await deps.fs.writeFile(gitignorePath, ignoreEntries.trimStart());
      deps.logger.info('Created .gitignore with .sentiness/ ignores');
    }

    // Soft dependency message for Phase 6
    deps.logger.info('\nNote: Agent adapters (Phase 6) are not yet built.');
    deps.logger.info('Run `sentiness install-skill --agent=<name>` later when available to install AI instructions.');

    const runBaseline = await prompter.confirm('\nCreate initial baseline now? (recommended for existing projects)', true);
    if (runBaseline) {
      deps.logger.info('Running baseline init...');
      await baselineInitCommand(args, deps);
    }

    deps.logger.info('\nSentiness initialization complete!');
  } finally {
    prompter.close();
  }

  return 0;
}

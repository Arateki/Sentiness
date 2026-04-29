import { join } from 'node:path';
import {
  detectPackageMetadata,
  type HookManager,
  type PackageManager,
} from '../../package-metadata/package-metadata.js';
import type { CommandDeps, ParsedArgs } from './types.js';

type HookName = 'pre-commit' | 'pre-push';

function sentinessCommand(packageManager: PackageManager): string {
  switch (packageManager) {
    case 'pnpm':
      return 'pnpm exec sentiness';
    case 'yarn':
      return 'yarn sentiness';
    case 'npm':
      return 'npx sentiness';
    case 'unknown':
      return 'npx sentiness';
  }
}

function checkArgs(hook: HookName): string {
  return hook === 'pre-commit'
    ? 'check --tier=fast --trigger=pre-commit'
    : 'check --tier=slow --trigger=pre-push';
}

function hookCommand(command: string, hook: HookName): string {
  return `${command} ${checkArgs(hook)}`;
}

function hookScript(commandLine: string, hook: HookName): string {
  const failure =
    hook === 'pre-commit'
      ? 'Sentiness quality checks failed. Please fix the issues before committing.'
      : 'Sentiness quality checks failed for push. Please fix the issues before pushing.';

  return `#!/bin/sh
# sentiness:start
# This block is managed by Sentiness.

${commandLine}
EXIT_CODE=$?

if [ $EXIT_CODE -ne 0 ]; then
  echo "${failure}"
  exit $EXIT_CODE
fi

exit 0
# sentiness:end
`;
}

function managedBlock(commandLine: string, hook: HookName): string {
  return `# sentiness:start ${hook}
${commandLine}
# sentiness:end ${hook}`;
}

function replaceManagedBlock(content: string, hook: HookName, block: string): string {
  const namedPattern = new RegExp(
    `# sentiness:start ${hook}[\\s\\S]*?# sentiness:end ${hook}`,
    'm',
  );
  if (namedPattern.test(content)) {
    return `${content.replace(namedPattern, block).trimEnd()}\n`;
  }

  const legacyPattern = /# sentiness:start[\s\S]*?# sentiness:end/m;
  if (legacyPattern.test(content)) {
    return `${content.replace(legacyPattern, block).trimEnd()}\n`;
  }

  return `${content.trimEnd()}\n\n${block}\n`;
}

async function writeExecutableHook(
  hookPath: string,
  hookName: HookName,
  content: string,
  deps: CommandDeps,
): Promise<void> {
  await deps.fs.writeFile(hookPath, content);
  try {
    await deps.fs.chmod(hookPath, 0o755);
  } catch (error) {
    deps.logger.warn(`Could not set executable bit on ${hookName} hook.`, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function installDirectHook(
  hookName: HookName,
  commandLine: string,
  deps: CommandDeps,
): Promise<void> {
  const hooksDir = join(deps.cwd, '.git', 'hooks');
  if (!(await deps.fs.exists(hooksDir))) {
    await deps.fs.mkdir(hooksDir, { recursive: true });
  }

  const hookPath = join(hooksDir, hookName);
  if (await deps.fs.exists(hookPath)) {
    const existing = await deps.fs.readFile(hookPath);
    if (!existing.includes('# sentiness:start')) {
      const backupPath = `${hookPath}.bak`;
      await deps.fs.rename(hookPath, backupPath);
      deps.logger.warn(`Existing ${hookName} hook backed up to ${backupPath}`);
    }
  }

  await writeExecutableHook(hookPath, hookName, hookScript(commandLine, hookName), deps);
  deps.logger.info(`Successfully installed ${hookName} hook at ${hookPath}`);
}

async function installHuskyHook(
  hookName: HookName,
  commandLine: string,
  deps: CommandDeps,
): Promise<void> {
  const huskyDir = join(deps.cwd, '.husky');
  await deps.fs.mkdir(huskyDir, { recursive: true });
  const hookPath = join(huskyDir, hookName);
  const block = managedBlock(commandLine, hookName);
  const content = (await deps.fs.exists(hookPath))
    ? replaceManagedBlock(await deps.fs.readFile(hookPath), hookName, block)
    : `#!/usr/bin/env sh\n\n${block}\n`;
  await writeExecutableHook(hookPath, hookName, content, deps);
  deps.logger.info(`Installed Sentiness ${hookName} hook through Husky at ${hookPath}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function installSimpleGitHook(
  hookName: HookName,
  commandLine: string,
  deps: CommandDeps,
): Promise<void> {
  const packageJsonPath = join(deps.cwd, 'package.json');
  const parsed: unknown = JSON.parse(await deps.fs.readFile(packageJsonPath));
  if (!isRecord(parsed)) {
    throw new Error('package.json must be an object to configure simple-git-hooks');
  }

  const existingConfig = isRecord(parsed['simple-git-hooks']) ? parsed['simple-git-hooks'] : {};
  const existingHook = existingConfig[hookName];
  const block = managedBlock(commandLine, hookName);
  const hookValue =
    typeof existingHook === 'string' ? replaceManagedBlock(existingHook, hookName, block) : block;

  await deps.fs.writeFile(
    packageJsonPath,
    `${JSON.stringify(
      {
        ...parsed,
        'simple-git-hooks': {
          ...existingConfig,
          [hookName]: hookValue.trimEnd(),
        },
      },
      null,
      2,
    )}\n`,
  );
  deps.logger.info(`Installed Sentiness ${hookName} hook through simple-git-hooks`);
}

async function findLefthookConfigPath(deps: CommandDeps): Promise<string> {
  for (const candidate of ['lefthook.yml', 'lefthook.yaml']) {
    const path = join(deps.cwd, candidate);
    if (await deps.fs.exists(path)) {
      return path;
    }
  }
  return join(deps.cwd, 'lefthook.yml');
}

function hasTopLevelHook(content: string, hook: HookName): boolean {
  return new RegExp(`^${hook}:`, 'm').test(content);
}

async function lefthookTargetPath(hookName: HookName, deps: CommandDeps): Promise<string> {
  const configPath = await findLefthookConfigPath(deps);
  if (!(await deps.fs.exists(configPath))) {
    return configPath;
  }

  const content = await deps.fs.readFile(configPath);
  if (content.includes(`# sentiness:start ${hookName}`) || !hasTopLevelHook(content, hookName)) {
    return configPath;
  }

  const localConfigPath = join(deps.cwd, 'lefthook-local.yml');
  deps.logger.warn(
    `Existing ${hookName} Lefthook section found in ${configPath}; writing Sentiness block to ${localConfigPath} to avoid rewriting user YAML.`,
  );
  return localConfigPath;
}

function lefthookBlock(commandLine: string, hook: HookName): string {
  return `# sentiness:start ${hook}
${hook}:
  commands:
    sentiness:
      run: ${commandLine}
# sentiness:end ${hook}`;
}

async function installLefthookHook(
  hookName: HookName,
  commandLine: string,
  deps: CommandDeps,
): Promise<void> {
  const configPath = await lefthookTargetPath(hookName, deps);
  const block = lefthookBlock(commandLine, hookName);
  const content = (await deps.fs.exists(configPath))
    ? replaceManagedBlock(await deps.fs.readFile(configPath), hookName, block)
    : `${block}\n`;
  await deps.fs.writeFile(configPath, content);
  deps.logger.info(`Installed Sentiness ${hookName} hook through Lefthook at ${configPath}`);
}

async function installManagedHook(
  manager: HookManager,
  hookName: HookName,
  commandLine: string,
  deps: CommandDeps,
): Promise<void> {
  switch (manager) {
    case 'husky':
      await installHuskyHook(hookName, commandLine, deps);
      return;
    case 'lefthook':
      await installLefthookHook(hookName, commandLine, deps);
      return;
    case 'simple-git-hooks':
      await installSimpleGitHook(hookName, commandLine, deps);
      return;
  }
}

export async function installHooksCommand(args: ParsedArgs, deps: CommandDeps): Promise<number> {
  const isRepo = await deps.git.isRepo(deps.cwd);
  if (!isRepo) {
    deps.logger.error('Not a git repository. Cannot install hooks.');
    return 1;
  }

  const metadata = await detectPackageMetadata(deps.cwd, deps.fs);
  const command = sentinessCommand(metadata.packageManager);
  const manager = metadata.hookManagers[0];

  if (!manager) {
    deps.logger.warn(
      'No hook manager detected; installing directly into .git/hooks. This will not be shared with collaborators after clone.',
    );
    deps.logger.info(
      'Install simple-git-hooks and re-run this command for a shareable hook setup.',
    );
    await installDirectHook('pre-commit', hookCommand(command, 'pre-commit'), deps);
  } else {
    await installManagedHook(manager, 'pre-commit', hookCommand(command, 'pre-commit'), deps);
  }

  if (args.push === true) {
    if (!manager) {
      await installDirectHook('pre-push', hookCommand(command, 'pre-push'), deps);
    } else {
      await installManagedHook(manager, 'pre-push', hookCommand(command, 'pre-push'), deps);
    }
  }

  return 0;
}

import { join } from 'node:path';
import type { CommandDeps, ParsedArgs } from './types.js';

export async function installHooksCommand(args: ParsedArgs, deps: CommandDeps): Promise<number> {
  const isRepo = await deps.git.isRepo(deps.cwd);
  if (!isRepo) {
    deps.logger.error('Not a git repository. Cannot install hooks.');
    return 1;
  }

  const hooksDir = join(deps.cwd, '.git', 'hooks');
  if (!(await deps.fs.exists(hooksDir))) {
    await deps.fs.mkdir(hooksDir, { recursive: true });
  }

  const hookScript = `#!/bin/sh
# Sentiness: pre-commit hook
# This file is managed by Sentiness.

# Run fast checks on changed files
pnpm sentiness check --tier=fast --diff --compact
EXIT_CODE=$?

if [ $EXIT_CODE -ne 0 ]; then
  echo "Sentiness quality checks failed. Please fix the issues before committing."
  exit $EXIT_CODE
fi

exit 0
`;

  const preCommitPath = join(hooksDir, 'pre-commit');
  await deps.fs.writeFile(preCommitPath, hookScript);

  // Make it executable (chmod +x)
  try {
    await deps.fs.chmod(preCommitPath, 0o755);
  } catch {
    deps.logger.warn(
      'Could not set executable bit on pre-commit hook. You might need to run `chmod +x .git/hooks/pre-commit` manually.',
    );
  }

  deps.logger.info(`Successfully installed pre-commit hook at ${preCommitPath}`);

  const pushHook = args.push === true;
  if (pushHook) {
    const prePushScript = `#!/bin/sh
# Sentiness: pre-push hook
# This file is managed by Sentiness.

# Run standard checks on the whole project
pnpm sentiness check --tier=standard --compact
EXIT_CODE=$?

if [ $EXIT_CODE -ne 0 ]; then
  echo "Sentiness quality checks failed for push. Please fix the issues before pushing."
  exit $EXIT_CODE
fi

exit 0
`;
    const prePushPath = join(hooksDir, 'pre-push');
    await deps.fs.writeFile(prePushPath, prePushScript);
    try {
      await deps.fs.chmod(prePushPath, 0o755);
    } catch {
      deps.logger.warn('Could not set executable bit on pre-push hook.');
    }
    deps.logger.info(`Successfully installed pre-push hook at ${prePushPath}`);
  }

  return 0;
}

import type { GitCommitInfo, GitProvider, ProcessRunner } from '@sentiness/check-sdk';

export class GitError extends Error {
  constructor(
    message: string,
    readonly command: string,
    readonly stderr: string,
  ) {
    super(message);
    this.name = 'GitError';
  }
}

async function git(process: ProcessRunner, cwd: string, args: readonly string[]): Promise<string> {
  const result = await process.execFile('git', args, { cwd });
  if (result.exitCode !== 0) {
    throw new GitError(`git ${args.join(' ')} failed`, `git ${args.join(' ')}`, result.stderr);
  }
  return result.stdout.trim();
}

export function createGitProvider(process: ProcessRunner): GitProvider {
  return {
    async isRepo(cwd) {
      const result = await process.execFile('git', ['rev-parse', '--is-inside-work-tree'], { cwd });
      return result.exitCode === 0 && result.stdout.trim() === 'true';
    },
    async currentBranch(cwd) {
      return git(process, cwd, ['branch', '--show-current']);
    },
    async changedFiles(cwd, baseRef) {
      const output = await git(process, cwd, [
        'diff',
        '--name-only',
        '--diff-filter=ACMRT',
        `${baseRef}...HEAD`,
      ]);
      return output.length === 0 ? [] : output.split('\n').filter(Boolean);
    },
    async fileContentAtRef(cwd, ref, path) {
      const result = await process.execFile('git', ['show', `${ref}:${path}`], { cwd });
      return result.exitCode === 0 ? result.stdout : null;
    },
    async mergeBase(cwd, refA, refB) {
      return git(process, cwd, ['merge-base', refA, refB]);
    },
    async showCommit(cwd, ref): Promise<GitCommitInfo> {
      const output = await git(process, cwd, ['show', '-s', '--format=%H%n%cI%n%an', ref]);
      const [sha, date, author] = output.split('\n');
      return {
        sha: sha ?? '',
        date: date ?? '',
        author: author ?? '',
      };
    },
  };
}

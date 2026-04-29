import type { GitCommitInfo, GitProvider } from '@sentiness/check-sdk';

export class InMemoryGitProvider implements GitProvider {
  changed: readonly string[] = [];
  files = new Map<string, string>();

  async isRepo(): Promise<boolean> {
    return true;
  }

  async currentBranch(): Promise<string> {
    return 'main';
  }

  async changedFiles(): Promise<readonly string[]> {
    return this.changed;
  }

  async fileContentAtRef(_cwd: string, ref: string, path: string): Promise<string | null> {
    return this.files.get(`${ref}:${path}`) ?? null;
  }

  async mergeBase(): Promise<string> {
    return 'base';
  }

  async showCommit(): Promise<GitCommitInfo> {
    return { sha: 'HEAD', date: '2024-01-01T00:00:00.000Z', author: 'Test' };
  }
}

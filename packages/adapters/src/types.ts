import type { FileSystem } from '@sentiness/check-sdk';

export interface RenderOptions {
  readonly sentinessVersion: string;
  readonly configPath: string;
  readonly baselinePath: string;
  readonly pendingPath: string;
}

export type AgentName = 'claude-code' | 'codex' | 'gemini';

export interface InstallResult {
  readonly agent: AgentName;
  readonly targetPath: string;
  readonly changed: boolean;
}

export interface AgentAdapter {
  readonly agent: AgentName;
  readonly targetFile: 'CLAUDE.md' | 'AGENTS.md' | 'GEMINI.md';
  install(cwd: string, fs: FileSystem, options: RenderOptions): Promise<InstallResult>;
}

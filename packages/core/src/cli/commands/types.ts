import type { AgentAdapter, AgentName } from '@sentiness/adapters';
import type { Clock, FileSystem, GitProvider, Logger, ProcessRunner } from '@sentiness/check-sdk';

export type OutputWriter = {
  write(text: string): void;
};

export type CommandDeps = {
  readonly cwd: string;
  readonly cacheRoot: string; // resolved by the launcher, passed via --cache-root
  readonly fs: FileSystem;
  readonly processRunner: ProcessRunner;
  readonly logger: Logger;
  readonly clock: Clock;
  readonly git: GitProvider;
  readonly stdout: OutputWriter;
  readonly cliPath?: string;
  readonly adapterLoader?: () => Promise<{
    readonly listAdapters: () => readonly AgentAdapter[];
    readonly getAdapter: (agent: AgentName) => AgentAdapter | undefined;
  }>;
};

export type ParsedArgs = {
  readonly _?: readonly string[];
  readonly [key: string]: unknown;
};

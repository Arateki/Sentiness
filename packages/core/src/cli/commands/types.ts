import type { Clock, FileSystem, GitProvider, Logger, ProcessRunner } from '@sentiness/check-sdk';

export type OutputWriter = {
  write(text: string): void;
};

export type CommandDeps = {
  readonly cwd: string;
  readonly fs: FileSystem;
  readonly processRunner: ProcessRunner;
  readonly logger: Logger;
  readonly clock: Clock;
  readonly git: GitProvider;
  readonly stdout: OutputWriter;
};

export type ParsedArgs = {
  readonly _?: readonly string[];
  readonly [key: string]: unknown;
};

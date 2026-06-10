import { execFile } from 'node:child_process';
import { delimiter, dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { ExecFileOptions, ExecFileResult, ProcessRunner } from '@sentiness/check-sdk';

const execFileAsync = promisify(execFile);

function localBinPaths(cwd: string): readonly string[] {
  const paths: string[] = [];
  let dir = resolve(cwd);
  for (;;) {
    paths.push(join(dir, 'node_modules', '.bin'));
    const parent = dirname(dir);
    if (parent === dir) {
      return paths;
    }
    dir = parent;
  }
}

// Tools like biome live in the target project's node_modules/.bin; when the
// CLI is invoked directly (not through a package-manager script) they are not
// on PATH. Prepend every node_modules/.bin from cwd upward, mirroring how
// npm/pnpm resolve binaries for scripts. Nonexistent entries are harmless.
function envWithLocalBins(
  cwd: string | undefined,
  extra: Readonly<Record<string, string>> | undefined,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...(extra ?? {}) };
  if (!cwd) {
    return env;
  }
  const prefix = localBinPaths(cwd).join(delimiter);
  env.PATH = env.PATH ? `${prefix}${delimiter}${env.PATH}` : prefix;
  return env;
}

type ExecError = Error & {
  readonly stdout?: string | Buffer;
  readonly stderr?: string | Buffer;
  readonly code?: number | string;
  readonly signal?: string;
};

function toText(value: string | Buffer | undefined): string {
  if (typeof value === 'string') {
    return value;
  }
  return value?.toString('utf8') ?? '';
}

function toExitCode(value: number | string | undefined): number {
  return typeof value === 'number' ? value : 1;
}

export class NodeProcessRunner implements ProcessRunner {
  async execFile(
    command: string,
    args: readonly string[],
    options?: ExecFileOptions,
  ): Promise<ExecFileResult> {
    try {
      const result = await execFileAsync(command, [...args], {
        cwd: options?.cwd,
        env: envWithLocalBins(options?.cwd, options?.env),
        signal: options?.signal,
        timeout: options?.timeoutMs,
        maxBuffer: 20 * 1024 * 1024,
      });
      return {
        stdout: toText(result.stdout),
        stderr: toText(result.stderr),
        exitCode: 0,
      };
    } catch (error) {
      const execError = error as ExecError;
      return {
        stdout: toText(execError.stdout),
        stderr: toText(execError.stderr) || execError.message,
        exitCode: toExitCode(execError.code),
        ...(execError.signal ? { signal: execError.signal } : {}),
      };
    }
  }
}

export function createProcessRunner(): ProcessRunner {
  return new NodeProcessRunner();
}

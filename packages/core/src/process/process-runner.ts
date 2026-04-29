import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ExecFileOptions, ExecFileResult, ProcessRunner } from '@sentiness/check-sdk';

const execFileAsync = promisify(execFile);

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
        ...(options?.env ? { env: { ...options.env } } : {}),
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

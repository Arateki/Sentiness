import { spawn } from 'node:child_process';
import type { ExecFileOptions, ExecFileResult, ProcessRunner } from '@sentiness/check-sdk';

// A ProcessRunner that streams child stdio straight to the launcher's own stdio
// with `inherit`. Long-running engine checks must show output live rather than
// buffering, so stdout/stderr are returned empty and the child writes directly
// to the terminal. The launcher only inspects the exit code in that case.
export function createProcessRunner(): ProcessRunner {
  return {
    execFile(command, args, options?: ExecFileOptions): Promise<ExecFileResult> {
      return new Promise((resolve) => {
        const child = spawn(command, [...args], {
          cwd: options?.cwd,
          stdio: 'inherit',
          signal: options?.signal,
        });
        child.on('error', (error) => {
          resolve({ stdout: '', stderr: error.message, exitCode: 1 });
        });
        child.on('close', (code, signal) => {
          resolve({
            stdout: '',
            stderr: '',
            exitCode: code ?? 1,
            ...(signal ? { signal } : {}),
          });
        });
      });
    },
  };
}

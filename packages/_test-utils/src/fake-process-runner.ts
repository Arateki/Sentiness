import type { ExecFileOptions, ExecFileResult, ProcessRunner } from '@sentiness/check-sdk';

export type ProcessCall = {
  readonly command: string;
  readonly args: readonly string[];
  readonly options?: ExecFileOptions;
};

export class FakeProcessRunner implements ProcessRunner {
  readonly calls: ProcessCall[] = [];
  private readonly responses: ExecFileResult[] = [];

  enqueue(response: ExecFileResult): void {
    this.responses.push(response);
  }

  async execFile(
    command: string,
    args: readonly string[],
    options?: ExecFileOptions,
  ): Promise<ExecFileResult> {
    this.calls.push({ command, args, ...(options ? { options } : {}) });
    return this.responses.shift() ?? { stdout: '', stderr: '', exitCode: 0 };
  }
}

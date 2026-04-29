import { describe, expect, it } from 'vitest';
import { FakeProcessRunner } from './fake-process-runner.js';

describe('FakeProcessRunner', () => {
  it('records calls and returns queued responses', async () => {
    const runner = new FakeProcessRunner();
    runner.enqueue({ stdout: 'ok', stderr: '', exitCode: 0 });

    await expect(runner.execFile('tool', ['--version'])).resolves.toEqual({
      stdout: 'ok',
      stderr: '',
      exitCode: 0,
    });
    expect(runner.calls).toEqual([{ command: 'tool', args: ['--version'] }]);
  });
});

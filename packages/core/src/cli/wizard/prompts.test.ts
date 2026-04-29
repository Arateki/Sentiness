import { describe, expect, it, vi } from 'vitest';
import { Prompter, type PromptInterface } from './prompts.js';

function fakeReadline(answers: readonly string[]): PromptInterface {
  const queue = [...answers];
  return {
    question: vi.fn(async () => queue.shift() ?? ''),
    close: vi.fn(),
  };
}

describe('Prompter', () => {
  it('uses injected readline and writer for invalid choices', async () => {
    const readline = fakeReadline(['invalid', '2']);
    const writer = { write: vi.fn() };
    const prompter = new Prompter({ readline, writer });

    const answer = await prompter.choice('Pick one', ['first', 'second'], 'first');
    prompter.close();

    expect(answer).toBe('second');
    expect(writer.write).toHaveBeenCalledWith('Invalid choice, please try again.\n');
    expect(readline.close).toHaveBeenCalled();
  });

  it('uses injected readline for confirmations', async () => {
    const readline = fakeReadline(['']);
    const writer = { write: vi.fn() };
    const prompter = new Prompter({ readline, writer });

    await expect(prompter.confirm('Continue?', true)).resolves.toBe(true);
    prompter.close();
  });
});

import { stdin as input, stdout as output } from 'node:process';
import { createInterface, type Interface } from 'node:readline/promises';
import type { OutputWriter } from '../commands/types.js';

export type PromptInterface = Pick<Interface, 'question' | 'close'>;

export type PrompterOptions = {
  readonly writer?: OutputWriter;
  readonly readline?: PromptInterface;
  readonly input?: NodeJS.ReadableStream;
  readonly output?: NodeJS.WritableStream;
};

function isOutputWriter(value: OutputWriter | PrompterOptions): value is OutputWriter {
  return 'write' in value;
}

export class Prompter {
  private readonly writer: OutputWriter;
  private readonly rl: PromptInterface;

  constructor(writerOrOptions: OutputWriter | PrompterOptions = {}) {
    const options = isOutputWriter(writerOrOptions) ? { writer: writerOrOptions } : writerOrOptions;
    this.writer = options.writer ?? { write: (text) => output.write(text) };
    this.rl =
      options.readline ??
      createInterface({ input: options.input ?? input, output: options.output ?? output });
  }

  async ask(question: string, defaultAnswer?: string): Promise<string> {
    const defaultText = defaultAnswer ? ` (${defaultAnswer})` : '';
    const answer = await this.rl.question(`${question}${defaultText}: `);
    return answer.trim() || defaultAnswer || '';
  }

  async confirm(question: string, defaultYes = true): Promise<boolean> {
    const hint = defaultYes ? 'Y/n' : 'y/N';
    const answer = await this.rl.question(`${question} [${hint}]: `);
    const normalized = answer.trim().toLowerCase();
    if (normalized === 'y' || normalized === 'yes') {
      return true;
    }
    if (normalized === 'n' || normalized === 'no') {
      return false;
    }
    return defaultYes;
  }

  async choice<T extends string>(
    question: string,
    options: readonly T[],
    defaultOption?: T,
  ): Promise<T> {
    const optionsText = options.map((opt, i) => `${i + 1}) ${opt}`).join('\n');
    const defaultHint = defaultOption ? ` (default: ${defaultOption})` : '';

    while (true) {
      const answer = await this.rl.question(`${question}\n${optionsText}\nChoice${defaultHint}: `);
      const normalized = answer.trim();

      if (!normalized && defaultOption) {
        return defaultOption;
      }

      const num = Number.parseInt(normalized, 10);
      if (!Number.isNaN(num) && num >= 1 && num <= options.length) {
        return options[num - 1] as T;
      }

      const match = options.find((opt) => opt.toLowerCase() === normalized.toLowerCase());
      if (match) {
        return match;
      }

      this.writer.write('Invalid choice, please try again.\n');
    }
  }

  close(): void {
    this.rl.close();
  }
}

import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';

export class Prompter {
  private readonly rl = createInterface({ input, output });

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

      console.log('Invalid choice, please try again.');
    }
  }

  close(): void {
    this.rl.close();
  }
}

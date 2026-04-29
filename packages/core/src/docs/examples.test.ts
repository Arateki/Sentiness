import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Command, cac } from 'cac';
import { describe, expect, it } from 'vitest';
import { registerCommands } from '../cli/commands/registry.js';
import type { CommandDeps } from '../cli/commands/types.js';

type DocExample = {
  readonly source: string;
  readonly commandLine: string;
  readonly tokens: readonly string[];
};

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const publicDocs = [
  'README.md',
  'docs/getting-started.md',
  'docs/baseline-strategy.md',
  'docs/agent-skill.md',
  'docs/writing-a-check.md',
] as const;
const baselineActions = new Set(['init', 'update', 'accept', 'prune']);
const pendingActions = new Set(['ack']);

function registeredCommands(): readonly Command[] {
  const cli = cac('sentiness');
  registerCommands(cli, {} as CommandDeps);
  return cli.commands;
}

function shellBlocks(markdown: string): readonly string[] {
  return [...markdown.matchAll(/```(?:sh|bash)\n([\s\S]*?)```/g)].map((match) => match[1] ?? '');
}

function joinedShellCommands(block: string): readonly string[] {
  const commands: string[] = [];
  let current = '';

  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) {
      continue;
    }

    const continued = line.endsWith('\\');
    const segment = continued ? line.slice(0, -1).trimEnd() : line;
    current = current ? `${current} ${segment.trim()}` : segment.trim();

    if (!continued) {
      commands.push(current);
      current = '';
    }
  }

  if (current) {
    commands.push(current);
  }

  return commands;
}

function inlineSentinessCommands(markdown: string): readonly string[] {
  return [...markdown.matchAll(/`((?:pnpm\s+)?sentiness\s+[^`]+)`/g)].map(
    (match) => match[1] ?? '',
  );
}

function tokenizeShell(commandLine: string): readonly string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | undefined;

  for (const character of commandLine) {
    if (quote) {
      if (character === quote) {
        quote = undefined;
      } else {
        current += character;
      }
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }

    if (/\s/.test(character)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += character;
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

function normalizeSentinessTokens(tokens: readonly string[]): readonly string[] | undefined {
  if (tokens[0] === 'sentiness') {
    return tokens;
  }
  if (tokens[0] === 'pnpm' && tokens[1] === 'sentiness') {
    return tokens.slice(1);
  }
  return undefined;
}

function sentinessExamples(): readonly DocExample[] {
  return publicDocs.flatMap((source) => {
    const markdown = readFileSync(join(repoRoot, source), 'utf8');
    const commandLines = [
      ...shellBlocks(markdown).flatMap((block) => joinedShellCommands(block)),
      ...inlineSentinessCommands(markdown),
    ];

    return commandLines.flatMap((commandLine) => {
      const tokens = normalizeSentinessTokens(tokenizeShell(commandLine));
      return tokens ? [{ source, commandLine, tokens }] : [];
    });
  });
}

function commandOptionNames(command: Command): ReadonlySet<string> {
  const names = new Set<string>();
  for (const option of command.options) {
    for (const name of option.names) {
      names.add(name);
    }
    if (option.negated) {
      names.add(`no-${option.name}`);
    }
  }
  return names;
}

function flagName(token: string): string | undefined {
  if (!token.startsWith('--')) {
    return undefined;
  }
  const [name] = token.slice(2).split('=');
  return name;
}

function positionalTokens(tokens: readonly string[]): readonly string[] {
  const positionals: string[] = [];
  let previousOptionNeedsValue = false;

  for (const token of tokens) {
    if (previousOptionNeedsValue) {
      previousOptionNeedsValue = false;
      continue;
    }

    if (token.startsWith('--')) {
      previousOptionNeedsValue = !token.includes('=');
      continue;
    }

    positionals.push(token);
  }

  return positionals;
}

function validationErrors(example: DocExample, commands: readonly Command[]): readonly string[] {
  const [, commandName, ...args] = example.tokens;
  const command = commands.find((candidate) => candidate.isMatched(commandName ?? ''));
  const prefix = `${example.source}: \`${example.commandLine}\``;
  if (!command || !commandName) {
    return [`${prefix}: unknown sentiness command ${commandName ?? '<missing>'}`];
  }

  const errors: string[] = [];
  const options = commandOptionNames(command);
  for (const token of args) {
    const option = flagName(token);
    if (option && !options.has(option)) {
      errors.push(`${prefix}: unknown option --${option} for sentiness ${commandName}`);
    }
  }

  const positionals = positionalTokens(args);
  if (commandName === 'baseline' && !baselineActions.has(positionals[0] ?? '')) {
    errors.push(`${prefix}: unknown baseline action ${positionals[0] ?? '<missing>'}`);
  }
  if (commandName === 'pending' && positionals[0] && !pendingActions.has(positionals[0])) {
    errors.push(`${prefix}: unknown pending action ${positionals[0]}`);
  }

  return errors;
}

describe('public docs CLI examples', () => {
  it('only documents registered sentiness commands, actions, and options', () => {
    const examples = sentinessExamples();
    const errors = examples.flatMap((example) => validationErrors(example, registeredCommands()));

    expect(examples.length).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });
});

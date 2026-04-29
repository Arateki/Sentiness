import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RenderOptions } from './types.js';

export const TEMPLATE_VERSION = '1.0' as const;

const TEMPLATE_PATH = join(dirname(fileURLToPath(import.meta.url)), 'skill-template.md');
const PLACEHOLDER_PATTERN = /\{\{([a-zA-Z0-9]+)\}\}/g;

function placeholderValues(options: RenderOptions): Readonly<Record<string, string>> {
  return {
    templateVersion: TEMPLATE_VERSION,
    sentinessVersion: options.sentinessVersion,
    configPath: options.configPath,
    baselinePath: options.baselinePath,
    pendingPath: options.pendingPath,
  };
}

export function renderTemplate(template: string, options: RenderOptions): string {
  const values = placeholderValues(options);
  const rendered = template.replace(PLACEHOLDER_PATTERN, (match, key: string) => {
    const value = values[key];
    if (value === undefined) {
      throw new Error(`Unknown skill template placeholder: ${match}`);
    }
    return value;
  });

  const unresolved = rendered.match(PLACEHOLDER_PATTERN);
  if (unresolved) {
    throw new Error(`Unresolved skill template placeholder: ${unresolved[0]}`);
  }

  return rendered;
}

export function renderSkill(options: RenderOptions): string {
  return renderTemplate(readFileSync(TEMPLATE_PATH, 'utf8'), options);
}

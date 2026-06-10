import type { LockfilePackages } from './lockfile.js';

// Classic quotes each specifier ('"a@1", "b@2"'), berry quotes the whole
// selector ('"a@npm:1, a@npm:2"'), so after splitting on ',' a specifier may
// carry an unmatched quote on either end. Strip them independently.
function stripQuotes(value: string): string {
  const start = value.startsWith('"') ? 1 : 0;
  const end = value.endsWith('"') ? value.length - 1 : value.length;
  return value.slice(start, end);
}

// A specifier looks like 'name@range' (classic) or 'name@npm:range' (berry);
// scoped names keep their leading '@', so the separator is the first '@' after it.
function nameFromSpecifier(specifier: string): string | undefined {
  const trimmed = stripQuotes(specifier.trim());
  const at = trimmed.indexOf('@', trimmed.startsWith('@') ? 1 : 0);
  if (at <= 0) {
    return undefined;
  }
  return trimmed.slice(0, at);
}

function namesFromSelector(selector: string): readonly string[] {
  const names: string[] = [];
  for (const specifier of selector.split(',')) {
    const name = nameFromSpecifier(specifier);
    if (name && !names.includes(name)) {
      names.push(name);
    }
  }
  return names;
}

// Matches both classic ('  version "1.2.3"') and berry ('  version: 1.2.3') entries.
const VERSION_LINE = /^\s+version:?\s+"?([^"\s]+)"?\s*$/;

export function parseYarnLockfile(content: string): LockfilePackages | undefined {
  const versions = new Map<string, string>();
  let currentNames: readonly string[] | undefined;
  let foundBlock = false;
  for (const line of content.split(/\r?\n/)) {
    if (line.trim().length === 0 || line.trimStart().startsWith('#')) {
      continue;
    }
    if (!line.startsWith(' ') && line.trimEnd().endsWith(':')) {
      const selector = line.trimEnd().slice(0, -1);
      currentNames = selector.startsWith('__') ? undefined : namesFromSelector(selector);
      continue;
    }
    if (!currentNames) {
      continue;
    }
    const versionMatch = VERSION_LINE.exec(line);
    if (versionMatch?.[1]) {
      foundBlock = true;
      for (const name of currentNames) {
        if (!versions.has(name)) {
          versions.set(name, versionMatch[1]);
        }
      }
      currentNames = undefined;
    }
  }
  return foundBlock ? versions : undefined;
}

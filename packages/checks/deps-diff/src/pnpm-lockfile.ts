import type { LockfilePackages } from './lockfile.js';

type PnpmKeyFormat = 'slash-version' | 'slash-at' | 'at';

type ParsedKey = { readonly name: string; readonly version: string };

function unquote(value: string): string {
  if (
    (value.startsWith("'") && value.endsWith("'")) ||
    (value.startsWith('"') && value.endsWith('"'))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

// pnpm changed the package-key shape across lockfile versions:
// 5.x -> '/name/1.2.3_peersuffix', 6.x -> '/name@1.2.3(peer)', 9.x -> 'name@1.2.3'.
function keyFormatFor(lockfileVersion: string): PnpmKeyFormat | undefined {
  const major = Number.parseInt(lockfileVersion, 10);
  if (major === 5) {
    return 'slash-version';
  }
  if (major === 6) {
    return 'slash-at';
  }
  if (major === 9) {
    return 'at';
  }
  return undefined;
}

function parseAtKey(key: string): ParsedKey | undefined {
  const withoutPeers = key.split('(')[0] ?? key;
  const at = withoutPeers.lastIndexOf('@');
  if (at <= 0) {
    return undefined;
  }
  const name = withoutPeers.slice(0, at);
  const version = withoutPeers.slice(at + 1);
  return name.length > 0 && version.length > 0 ? { name, version } : undefined;
}

function parseSlashVersionKey(key: string): ParsedKey | undefined {
  const slash = key.lastIndexOf('/');
  if (slash <= 0) {
    return undefined;
  }
  const name = key.slice(0, slash);
  // Semver never contains '_'; pnpm v5 appends peer info after it.
  const version = key.slice(slash + 1).split('_')[0] ?? '';
  return name.length > 0 && version.length > 0 ? { name, version } : undefined;
}

function parsePackageKey(key: string, format: PnpmKeyFormat): ParsedKey | undefined {
  if (format === 'at') {
    return parseAtKey(key);
  }
  if (!key.startsWith('/')) {
    return undefined;
  }
  const tail = key.slice(1);
  return format === 'slash-at' ? parseAtKey(tail) : parseSlashVersionKey(tail);
}

export function parsePnpmLockfile(content: string): LockfilePackages | undefined {
  const lines = content.split(/\r?\n/);
  const versionMatch = /^lockfileVersion:\s*['"]?([\d.]+)['"]?\s*$/m.exec(content);
  const format = versionMatch?.[1] ? keyFormatFor(versionMatch[1]) : undefined;
  if (!format) {
    return undefined;
  }

  const versions = new Map<string, string>();
  let inPackages = false;
  let foundPackagesSection = false;
  for (const line of lines) {
    if (/^packages:\s*$/.test(line)) {
      inPackages = true;
      foundPackagesSection = true;
      continue;
    }
    if (!inPackages) {
      continue;
    }
    if (line.trim().length === 0) {
      continue;
    }
    if (!line.startsWith(' ')) {
      inPackages = false;
      continue;
    }
    // Package keys sit at exactly two spaces; deeper lines are entry properties.
    const keyMatch = /^ {2}(\S.*):\s*$/.exec(line);
    if (!keyMatch?.[1]) {
      continue;
    }
    const parsed = parsePackageKey(unquote(keyMatch[1]), format);
    if (parsed && !versions.has(parsed.name)) {
      versions.set(parsed.name, parsed.version);
    }
  }
  return foundPackagesSection ? versions : undefined;
}

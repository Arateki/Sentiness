import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FakeProcessRunner,
  FixedClock,
  InMemoryGitProvider,
  SilentLogger,
} from '@sentiness/_test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNodeFileSystem } from '../../fs/node-fs.js';
import { initConfigCommand } from './init-config.js';
import type { CommandDeps } from './types.js';

function writeMockCheck(
  cwd: string,
  id: string,
  options: { configFiles?: readonly string[]; defaultPath?: string; defaultContent?: string },
): void {
  const packageDir = join(cwd, 'node_modules', '@sentiness', `check-${id}`);
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(
    join(packageDir, 'package.json'),
    JSON.stringify({ name: `@sentiness/check-${id}`, type: 'module', exports: './index.js' }),
  );
  const fragments: string[] = [
    `id: "${id}"`,
    'category: "lint"',
    'defaultTier: "fast"',
    'detect: async () => ({ available: true })',
    'run: async () => ({ status: "ok", findings: [], durationMs: 0 })',
  ];
  if (options.configFiles) {
    fragments.push(`configFiles: ${JSON.stringify(options.configFiles)}`);
  }
  if (options.defaultPath && options.defaultContent !== undefined) {
    fragments.push(
      `defaultConfig: () => ({ path: ${JSON.stringify(options.defaultPath)}, content: ${JSON.stringify(options.defaultContent)} })`,
    );
  }
  writeFileSync(join(packageDir, 'index.js'), `export default { ${fragments.join(', ')} };`);
}

describe('initConfigCommand', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'sentiness-init-config-'));
    writeFileSync(
      join(cwd, 'package.json'),
      JSON.stringify({ name: 'init-config-test', type: 'module' }),
    );
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  function deps(stdout = vi.fn()): CommandDeps {
    return {
      cwd,
      fs: createNodeFileSystem(),
      processRunner: new FakeProcessRunner(),
      logger: new SilentLogger(),
      clock: new FixedClock(1714348800000),
      git: new InMemoryGitProvider(),
      stdout: { write: stdout },
    };
  }

  it('creates a default config file when none of the configFiles exist', async () => {
    writeMockCheck(cwd, 'demo', {
      configFiles: ['demo.conf.json'],
      defaultPath: 'demo.conf.json',
      defaultContent: '{"hello":"world"}\n',
    });
    writeFileSync(
      join(cwd, 'sentiness.config.json'),
      JSON.stringify({
        schemaVersion: '1.0',
        checks: { demo: { enabled: true, tier: 'fast' } },
      }),
    );
    const stdout = vi.fn();

    const exit = await initConfigCommand({}, deps(stdout));

    expect(exit).toBe(0);
    expect(readFileSync(join(cwd, 'demo.conf.json'), 'utf-8')).toBe('{"hello":"world"}\n');
    const printed = JSON.parse(String(stdout.mock.calls[0]?.[0]));
    expect(printed.outcomes[0].action).toBe('created');
  });

  it('skips creation when an existing config is present', async () => {
    writeMockCheck(cwd, 'demo', {
      configFiles: ['demo.conf.json'],
      defaultPath: 'demo.conf.json',
      defaultContent: '{"hello":"world"}\n',
    });
    writeFileSync(join(cwd, 'demo.conf.json'), '{"existing":true}');
    writeFileSync(
      join(cwd, 'sentiness.config.json'),
      JSON.stringify({
        schemaVersion: '1.0',
        checks: { demo: { enabled: true, tier: 'fast' } },
      }),
    );
    const stdout = vi.fn();

    const exit = await initConfigCommand({}, deps(stdout));

    expect(exit).toBe(0);
    expect(readFileSync(join(cwd, 'demo.conf.json'), 'utf-8')).toBe('{"existing":true}');
    const printed = JSON.parse(String(stdout.mock.calls[0]?.[0]));
    expect(printed.outcomes[0].action).toBe('skipped-existing');
  });

  it('overwrites when --force is set', async () => {
    writeMockCheck(cwd, 'demo', {
      configFiles: ['demo.conf.json'],
      defaultPath: 'demo.conf.json',
      defaultContent: '{"fresh":true}\n',
    });
    writeFileSync(join(cwd, 'demo.conf.json'), '{"existing":true}');
    writeFileSync(
      join(cwd, 'sentiness.config.json'),
      JSON.stringify({
        schemaVersion: '1.0',
        checks: { demo: { enabled: true, tier: 'fast' } },
      }),
    );

    const exit = await initConfigCommand({ force: true }, deps());

    expect(exit).toBe(0);
    expect(readFileSync(join(cwd, 'demo.conf.json'), 'utf-8')).toBe('{"fresh":true}\n');
  });

  it('reports skipped-no-default when a check declares files but no default', async () => {
    writeMockCheck(cwd, 'demo', { configFiles: ['demo.conf.json'] });
    writeFileSync(
      join(cwd, 'sentiness.config.json'),
      JSON.stringify({
        schemaVersion: '1.0',
        checks: { demo: { enabled: true, tier: 'fast' } },
      }),
    );
    const stdout = vi.fn();

    const exit = await initConfigCommand({}, deps(stdout));

    expect(exit).toBe(0);
    const printed = JSON.parse(String(stdout.mock.calls[0]?.[0]));
    expect(printed.outcomes[0].action).toBe('skipped-no-default');
  });

  it('returns 1 when --check targets an id that is not enabled', async () => {
    writeFileSync(join(cwd, 'sentiness.config.json'), JSON.stringify({ schemaVersion: '1.0' }));

    const exit = await initConfigCommand({ check: 'unknown' }, deps());

    expect(exit).toBe(1);
  });
});

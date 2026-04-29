import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
import { doctorCommand } from './doctor.js';
import type { CommandDeps } from './types.js';

function writeMockCheck(cwd: string, id: string, detectBody: string): void {
  const packageDir = join(cwd, 'node_modules', '@sentiness', `check-${id}`);
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(
    join(packageDir, 'package.json'),
    JSON.stringify({ name: `@sentiness/check-${id}`, type: 'module', exports: './index.js' }),
  );
  writeFileSync(
    join(packageDir, 'index.js'),
    `export default {
      id: "${id}",
      category: "lint",
      defaultTier: "fast",
      detect: ${detectBody},
      run: async () => ({ status: "ok", findings: [], durationMs: 0 })
    };`,
  );
}

describe('doctorCommand', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'sentiness-doctor-'));
    writeFileSync(
      join(cwd, 'package.json'),
      JSON.stringify({ name: 'doctor-test', type: 'module' }),
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

  it('returns non-zero when an enabled check is unavailable', async () => {
    writeMockCheck(cwd, 'fake', 'async () => ({ available: false, reason: "missing fake" })');
    writeFileSync(
      join(cwd, 'sentiness.config.json'),
      JSON.stringify({
        schemaVersion: '1.0',
        checks: { fake: { enabled: true, tier: 'fast' } },
      }),
    );
    const stdout = vi.fn();

    const exitCode = await doctorCommand({}, deps(stdout));

    expect(exitCode).toBe(1);
    const report = JSON.parse(String(stdout.mock.calls[0]?.[0]));
    expect(report.ok).toBe(false);
    expect(report.checks[0].available).toBe(false);
    expect(report.checks[0].reason).toBe('missing fake');
  });

  it('returns zero when all enabled checks are available', async () => {
    writeMockCheck(cwd, 'fake', 'async () => ({ available: true, version: "1.0.0" })');
    writeFileSync(
      join(cwd, 'sentiness.config.json'),
      JSON.stringify({
        schemaVersion: '1.0',
        checks: { fake: { enabled: true, tier: 'fast' } },
      }),
    );

    const exitCode = await doctorCommand({}, deps());

    expect(exitCode).toBe(0);
  });
});

import { FakeProcessRunner, InMemoryFileSystem, SilentLogger } from '@sentiness/_test-utils';
import { describe, expect, it } from 'vitest';
import { run } from './bootstrap.js';

function baseDeps(fs: InMemoryFileSystem, processRunner: FakeProcessRunner) {
  const out: string[] = [];
  const err: string[] = [];
  return {
    deps: {
      cwd: '/project',
      env: { SENTINESS_HOME: '/home/u/.sentiness' },
      fs,
      process: processRunner,
      logger: new SilentLogger(),
      stdout: { write: (t: string) => out.push(t) },
      stderr: { write: (t: string) => err.push(t) },
    },
    out,
    err,
  };
}

const config = JSON.stringify({
  schemaVersion: '2.0',
  engine: '2.0.0',
  checks: { biome: { version: '1.3.0' } },
});
const lock = JSON.stringify({
  lockfileVersion: 1,
  engine: { version: '2.0.0' },
  checks: { biome: { version: '1.3.0' } },
});

describe('launcher run', () => {
  it('exits 3 with a helpful message when no config is found', async () => {
    const { deps, err } = baseDeps(new InMemoryFileSystem(), new FakeProcessRunner());
    expect(await run(['check'], deps)).toBe(3);
    expect(err.join('')).toMatch(/sentiness.config/);
  });

  it('exits 3 telling the user to run install when the lock is absent', async () => {
    const fs = new InMemoryFileSystem({ '/project/sentiness.config.json': config });
    const { deps, err } = baseDeps(fs, new FakeProcessRunner());
    expect(await run(['check'], deps)).toBe(3);
    expect(err.join('')).toMatch(/sentiness install/);
  });

  it('fetches the engine if missing and spawns it with --cache-root, forwarding the exit code', async () => {
    const fs = new InMemoryFileSystem({
      '/project/sentiness.config.json': config,
      '/project/sentiness.lock': lock,
    });
    const process = new FakeProcessRunner();
    process.enqueue({ stdout: '', stderr: '', exitCode: 0 }); // npm install (engine)
    process.enqueue({ stdout: 'REPORT', stderr: '', exitCode: 1 }); // node engine cli (exit 1 = findings)
    const { deps, out } = baseDeps(fs, process);

    const code = await run(['check', '--tier=fast'], deps);

    const installCall = process.calls[0];
    expect(installCall?.command).toBe('npm');
    expect(installCall?.args).toContain('@sentiness/core@2.0.0');
    const spawnCall = process.calls[1];
    expect(spawnCall?.command).toBe('node');
    expect(spawnCall?.args).toContain('--cache-root');
    expect(spawnCall?.args).toContain('/home/u/.sentiness');
    expect(spawnCall?.args).toContain('check');
    expect(out.join('')).toBe('REPORT');
    expect(code).toBe(1);
  });

  it('reuses an already-materialized engine without re-fetching', async () => {
    const fs = new InMemoryFileSystem({
      '/project/sentiness.config.json': config,
      '/project/sentiness.lock': lock,
      '/home/u/.sentiness/cache/engine/2.0.0/.sentiness-materialized': 'x',
    });
    const process = new FakeProcessRunner();
    process.enqueue({ stdout: 'REPORT', stderr: '', exitCode: 0 }); // only the spawn
    const { deps } = baseDeps(fs, process);

    const code = await run(['check'], deps);

    expect(process.calls).toHaveLength(1);
    expect(process.calls[0]?.command).toBe('node');
    expect(code).toBe(0);
  });

  it('uses SENTINESS_ENGINE_PATH to bypass the fetch for local development', async () => {
    const fs = new InMemoryFileSystem({ '/project/sentiness.config.json': config });
    const process = new FakeProcessRunner();
    process.enqueue({ stdout: 'REPORT', stderr: '', exitCode: 0 });
    const out: string[] = [];
    const deps = {
      cwd: '/project',
      env: { SENTINESS_HOME: '/home/u/.sentiness', SENTINESS_ENGINE_PATH: '/repo/packages/core' },
      fs,
      process,
      logger: new SilentLogger(),
      stdout: { write: (t: string) => out.push(t) },
      stderr: { write: () => {} },
    };

    const code = await run(['doctor'], deps);

    const spawnCall = process.calls[0];
    expect(spawnCall?.command).toBe('node');
    expect(spawnCall?.args[0]).toBe('/repo/packages/core/dist/cli/index.js');
    expect(spawnCall?.args).toContain('--cache-root');
    expect(code).toBe(0);
  });
});

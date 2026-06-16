import {
  FakeProcessRunner,
  FixedClock,
  InMemoryFileSystem,
  InMemoryGitProvider,
  SilentLogger,
} from '@sentiness/_test-utils';
import { describe, expect, it } from 'vitest';
import { installCommand } from './install.js';
import type { CommandDeps } from './types.js';

function deps(fs: InMemoryFileSystem, processRunner: FakeProcessRunner): CommandDeps {
  return {
    cwd: '/project',
    cacheRoot: '/home/u/.sentiness',
    fs,
    processRunner,
    logger: new SilentLogger(),
    clock: new FixedClock(0),
    git: new InMemoryGitProvider(),
    stdout: { write: () => {} },
  };
}

const config = {
  schemaVersion: '2.0',
  engine: '^2.0.0',
  checks: { biome: { version: '^1.3.0' } },
};

describe('installCommand', () => {
  it('resolves ranges, writes the lock, and materializes slots (non-frozen)', async () => {
    const fs = new InMemoryFileSystem({ '/project/sentiness.config.json': JSON.stringify(config) });
    const process = new FakeProcessRunner();
    // npm view @sentiness/core@^2.0.0 version --json
    process.enqueue({ stdout: '"2.0.1"', stderr: '', exitCode: 0 });
    // npm install (engine slot)
    process.enqueue({ stdout: '', stderr: '', exitCode: 0 });
    // npm view @sentiness/check-biome@^1.3.0 version --json
    process.enqueue({ stdout: '"1.3.4"', stderr: '', exitCode: 0 });
    // npm install (check slot)
    process.enqueue({ stdout: '', stderr: '', exitCode: 0 });

    const code = await installCommand({ frozen: false }, deps(fs, process));
    expect(code).toBe(0);
    const lock = JSON.parse(await fs.readFile('/project/sentiness.lock'));
    expect(lock.engine.version).toBe('2.0.1');
    expect(lock.checks.biome.version).toBe('1.3.4');
  });

  it('records a path-linked check in the lock without fetching it', async () => {
    const linked = {
      schemaVersion: '2.0',
      engine: '^2.0.0',
      checks: { biome: { path: 'packages/checks/biome' } },
    };
    const fs = new InMemoryFileSystem({
      '/project/sentiness.config.json': JSON.stringify(linked),
    });
    const process = new FakeProcessRunner();
    // npm view @sentiness/core@^2.0.0 version --json
    process.enqueue({ stdout: '"2.0.1"', stderr: '', exitCode: 0 });
    // npm install (engine slot)
    process.enqueue({ stdout: '', stderr: '', exitCode: 0 });

    const code = await installCommand({ frozen: false }, deps(fs, process));
    expect(code).toBe(0);
    const lock = JSON.parse(await fs.readFile('/project/sentiness.lock'));
    expect(lock.checks.biome.path).toBe('packages/checks/biome');
    expect(lock.checks.biome.version).toBeUndefined();
  });

  it('--frozen fails when the lock is missing', async () => {
    const fs = new InMemoryFileSystem({ '/project/sentiness.config.json': JSON.stringify(config) });
    const code = await installCommand({ frozen: true }, deps(fs, new FakeProcessRunner()));
    expect(code).toBe(3);
  });

  it('--frozen fails when the lock does not satisfy the config', async () => {
    const fs = new InMemoryFileSystem({
      '/project/sentiness.config.json': JSON.stringify(config),
      '/project/sentiness.lock': JSON.stringify({
        lockfileVersion: 1,
        engine: { version: '1.9.0' },
        checks: { biome: { version: '1.3.4' } },
      }),
    });
    const code = await installCommand({ frozen: true }, deps(fs, new FakeProcessRunner()));
    expect(code).toBe(3);
  });

  it('--frozen materializes from a satisfying lock', async () => {
    const fs = new InMemoryFileSystem({
      '/project/sentiness.config.json': JSON.stringify(config),
      '/project/sentiness.lock': JSON.stringify({
        lockfileVersion: 1,
        engine: { version: '2.0.1' },
        checks: { biome: { version: '1.3.4' } },
      }),
    });
    const process = new FakeProcessRunner();
    // engine + check materialize
    process.enqueue({ stdout: '', stderr: '', exitCode: 0 });
    process.enqueue({ stdout: '', stderr: '', exitCode: 0 });
    const code = await installCommand({ frozen: true }, deps(fs, process));
    expect(code).toBe(0);
  });
});

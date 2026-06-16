import { FakeProcessRunner, InMemoryFileSystem, SilentLogger } from '@sentiness/_test-utils';
import { describe, expect, it } from 'vitest';
import { ArtifactFetchError, createArtifactStore } from './artifact-store.js';
import { createCachePaths } from './paths.js';

function makeStore(fs: InMemoryFileSystem, process: FakeProcessRunner) {
  return createArtifactStore({
    paths: createCachePaths('/home/u/.sentiness'),
    fs,
    process,
    logger: new SilentLogger(),
    randomId: () => 'TMPID',
  });
}

const ref = { kind: 'check', id: 'biome', version: '1.3.0' } as const;

describe('artifact store', () => {
  it('isMaterialized is false before, true after a marker is written', async () => {
    const fs = new InMemoryFileSystem();
    const store = makeStore(fs, new FakeProcessRunner());
    expect(await store.isMaterialized(ref)).toBe(false);
    await fs.writeFile('/home/u/.sentiness/cache/checks/biome/1.3.0/.sentiness-materialized', 'x');
    expect(await store.isMaterialized(ref)).toBe(true);
  });

  it('materialize runs npm install with the exact spec and renames into the slot', async () => {
    const fs = new InMemoryFileSystem();
    const process = new FakeProcessRunner();
    process.enqueue({ stdout: '', stderr: '', exitCode: 0 });
    const store = makeStore(fs, process);

    const result = await store.materialize(ref, { packageName: '@sentiness/check-biome' });

    expect(process.calls[0]?.command).toBe('npm');
    expect(process.calls[0]?.args).toEqual([
      'install',
      '--prefix',
      '/home/u/.sentiness/cache/tmp/TMPID',
      '--no-save',
      '--no-audit',
      '--no-fund',
      '@sentiness/check-biome@1.3.0',
    ]);
    expect(result.path).toBe('/home/u/.sentiness/cache/checks/biome/1.3.0');
    expect(await store.isMaterialized(ref)).toBe(true);
  });

  it('appends extraInstalls (toolVersion override) to the npm spec', async () => {
    const fs = new InMemoryFileSystem();
    const process = new FakeProcessRunner();
    process.enqueue({ stdout: '', stderr: '', exitCode: 0 });
    const store = makeStore(fs, process);
    await store.materialize(ref, {
      packageName: '@sentiness/check-biome',
      extraInstalls: ['@biomejs/biome@1.9.0'],
    });
    expect(process.calls[0]?.args).toContain('@biomejs/biome@1.9.0');
  });

  it('throws ArtifactFetchError and leaves no marker when npm fails', async () => {
    const fs = new InMemoryFileSystem();
    const process = new FakeProcessRunner();
    process.enqueue({ stdout: '', stderr: 'network error', exitCode: 1 });
    const store = makeStore(fs, process);
    await expect(
      store.materialize(ref, { packageName: '@sentiness/check-biome' }),
    ).rejects.toBeInstanceOf(ArtifactFetchError);
    expect(await store.isMaterialized(ref)).toBe(false);
  });

  it('is idempotent: a materialized slot is not re-fetched', async () => {
    const fs = new InMemoryFileSystem({
      '/home/u/.sentiness/cache/checks/biome/1.3.0/.sentiness-materialized': 'x',
    });
    const process = new FakeProcessRunner();
    const store = makeStore(fs, process);
    await store.materialize(ref, { packageName: '@sentiness/check-biome' });
    expect(process.calls).toHaveLength(0);
  });
});

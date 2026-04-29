import { describe, expect, it } from 'vitest';
import { InMemoryFileSystem } from './in-memory-fs.js';

describe('InMemoryFileSystem', () => {
  it('writes, reads, renames, and lists files', async () => {
    const fs = new InMemoryFileSystem();
    await fs.mkdir('/project/src', { recursive: true });
    await fs.writeFile('/project/src/index.ts', 'hello');
    await fs.rename('/project/src/index.ts', '/project/src/main.ts');

    await expect(fs.readFile('/project/src/main.ts')).resolves.toBe('hello');
    await expect(fs.readDir('/project/src')).resolves.toEqual(['main.ts']);
  });
});

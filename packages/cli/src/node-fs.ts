import {
  appendFile,
  chmod,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import type { FileSystem } from '@sentiness/check-sdk';

// A FileSystem over node:fs/promises. The launcher uses only a subset (exists,
// readFile, writeFile, mkdir), but the full interface is implemented so it can
// stand in wherever a FileSystem is expected without depending on @sentiness/core.
export function createNodeFileSystem(): FileSystem {
  return {
    readFile: (path) => readFile(path, 'utf8'),
    writeFile: (path, content) => writeFile(path, content, 'utf8'),
    appendFile: (path, content) => appendFile(path, content, 'utf8'),
    rename: (from, to) => rename(from, to),
    async exists(path) {
      try {
        await stat(path);
        return true;
      } catch {
        return false;
      }
    },
    async mkdir(path, options) {
      await mkdir(path, { recursive: options?.recursive ?? false });
    },
    rm: (path, options) => rm(path, { recursive: options?.recursive, force: options?.force }),
    chmod: (path, mode) => chmod(path, mode),
    readDir: (path) => readdir(path),
    async stat(path) {
      const stats = await stat(path);
      return {
        isFile: stats.isFile(),
        isDirectory: stats.isDirectory(),
        size: stats.size,
        mtimeMs: stats.mtimeMs,
      };
    },
    realpath: (path) => realpath(path),
  };
}

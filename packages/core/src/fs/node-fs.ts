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
import type { FileStat, FileSystem } from '@sentiness/check-sdk';

export class NodeFileSystem implements FileSystem {
  async readFile(path: string): Promise<string> {
    return readFile(path, 'utf8');
  }

  async writeFile(path: string, content: string): Promise<void> {
    await writeFile(path, content, 'utf8');
  }

  async appendFile(path: string, content: string): Promise<void> {
    await appendFile(path, content, 'utf8');
  }

  async rename(from: string, to: string): Promise<void> {
    await rename(from, to);
  }

  async exists(path: string): Promise<boolean> {
    try {
      await stat(path);
      return true;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return false;
      }
      throw error;
    }
  }

  async mkdir(path: string, options?: { readonly recursive?: boolean }): Promise<void> {
    await mkdir(path, { recursive: options?.recursive ?? false });
  }

  async rm(
    path: string,
    options?: { readonly recursive?: boolean; readonly force?: boolean },
  ): Promise<void> {
    await rm(path, { recursive: options?.recursive ?? false, force: options?.force ?? false });
  }

  async chmod(path: string, mode: number): Promise<void> {
    await chmod(path, mode);
  }

  async readDir(path: string): Promise<readonly string[]> {
    return readdir(path);
  }

  async stat(path: string): Promise<FileStat> {
    const info = await stat(path);
    return {
      isFile: info.isFile(),
      isDirectory: info.isDirectory(),
      size: info.size,
      mtimeMs: info.mtimeMs,
    };
  }

  async realpath(path: string): Promise<string> {
    return realpath(path);
  }
}

export function createNodeFileSystem(): FileSystem {
  return new NodeFileSystem();
}

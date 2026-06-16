import { dirname, join, normalize, resolve } from 'node:path';
import type { FileStat, FileSystem } from '@sentiness/check-sdk';

function normalizePath(path: string): string {
  return normalize(resolve('/', path));
}

export class InMemoryFileSystem implements FileSystem {
  private readonly files = new Map<
    string,
    { readonly content: string; readonly mtimeMs: number }
  >();
  private readonly directories = new Set<string>(['/']);

  constructor(initialFiles: Readonly<Record<string, string>> = {}) {
    for (const [path, content] of Object.entries(initialFiles)) {
      this.writeSync(path, content);
    }
  }

  private writeSync(path: string, content: string): void {
    const normalized = normalizePath(path);
    this.ensureDir(dirname(normalized));
    this.files.set(normalized, { content, mtimeMs: Date.now() });
  }

  private ensureDir(path: string): void {
    const normalized = normalizePath(path);
    if (this.directories.has(normalized)) {
      return;
    }
    this.ensureDir(dirname(normalized));
    this.directories.add(normalized);
  }

  async readFile(path: string): Promise<string> {
    const file = this.files.get(normalizePath(path));
    if (!file) {
      throw new Error(`File not found: ${path}`);
    }
    return file.content;
  }

  async writeFile(path: string, content: string): Promise<void> {
    this.writeSync(path, content);
  }

  async appendFile(path: string, content: string): Promise<void> {
    const current = (await this.exists(path)) ? await this.readFile(path) : '';
    this.writeSync(path, `${current}${content}`);
  }

  async rename(from: string, to: string): Promise<void> {
    const normalizedFrom = normalizePath(from);
    const file = this.files.get(normalizedFrom);
    if (file) {
      this.files.delete(normalizedFrom);
      this.writeSync(to, file.content);
      return;
    }
    if (this.directories.has(normalizedFrom)) {
      const normalizedTo = normalizePath(to);
      const prefix = `${normalizedFrom}/`;
      for (const [path, value] of [...this.files.entries()]) {
        if (path.startsWith(prefix)) {
          this.files.delete(path);
          this.writeSync(join(normalizedTo, path.slice(prefix.length)), value.content);
        }
      }
      for (const dir of [...this.directories]) {
        if (dir === normalizedFrom || dir.startsWith(prefix)) {
          this.directories.delete(dir);
        }
      }
      this.ensureDir(normalizedTo);
      return;
    }
    throw new Error(`Path not found: ${from}`);
  }

  async exists(path: string): Promise<boolean> {
    const normalized = normalizePath(path);
    return this.files.has(normalized) || this.directories.has(normalized);
  }

  async mkdir(path: string, options?: { readonly recursive?: boolean }): Promise<void> {
    const normalized = normalizePath(path);

    if (options?.recursive) {
      this.ensureDir(path);
      return;
    }
    const parent = dirname(normalized);
    if (!this.directories.has(parent)) {
      throw new Error(`Parent directory does not exist: ${parent}`);
    }
    if (this.directories.has(normalized) || this.files.has(normalized)) {
      const err = new Error(`EEXIST: file or directory already exists, mkdir '${path}'`);
      Object.assign(err, { code: 'EEXIST' });
      throw err;
    }
    this.directories.add(normalized);
  }

  async rm(path: string): Promise<void> {
    const normalized = normalizePath(path);
    this.files.delete(normalized);
    this.directories.delete(normalized);
  }

  async chmod(): Promise<void> {
    return;
  }

  async readDir(path: string): Promise<readonly string[]> {
    const normalized = normalizePath(path);
    const prefix = normalized.endsWith('/') ? normalized : `${normalized}/`;
    const entries = new Set<string>();
    for (const file of this.files.keys()) {
      if (file.startsWith(prefix)) {
        entries.add(file.slice(prefix.length).split('/')[0] ?? '');
      }
    }
    for (const dir of this.directories) {
      if (dir.startsWith(prefix) && dir !== normalized) {
        entries.add(dir.slice(prefix.length).split('/')[0] ?? '');
      }
    }
    return [...entries].filter(Boolean).sort();
  }

  async stat(path: string): Promise<FileStat> {
    const normalized = normalizePath(path);
    const file = this.files.get(normalized);
    if (file) {
      return { isFile: true, isDirectory: false, size: file.content.length, mtimeMs: file.mtimeMs };
    }
    if (this.directories.has(normalized)) {
      return { isFile: false, isDirectory: true, size: 0, mtimeMs: 0 };
    }
    throw new Error(`Path not found: ${path}`);
  }

  async realpath(path: string): Promise<string> {
    return normalizePath(path);
  }
}

export function makeProjectFile(path: string): string {
  return join('/project', path);
}

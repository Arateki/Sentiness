import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import type { Clock, FileSystem, Tier } from '@sentiness/check-sdk';

export interface PendingItem {
  readonly id: string;
  readonly jobId: string;
  readonly createdAt: string;
  readonly tier: Tier;
  readonly summary: string;
  readonly reportPath: string;
  readonly acked: boolean;
}

export class PendingQueueLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PendingQueueLockError';
  }
}

const MAX_RETRIES = 5;
const BASE_BACKOFF_MS = 50;

export class PendingQueue {
  private readonly lockDir: string;

  constructor(
    private readonly path: string,
    private readonly fs: FileSystem,
    private readonly clock: Clock,
  ) {
    const _dir = dirname(path);
    this.lockDir = `${path}.lock`;
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async acquireLock(): Promise<void> {
    const parentDir = dirname(this.lockDir);
    await this.fs.mkdir(parentDir, { recursive: true });

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        await this.fs.mkdir(this.lockDir, { recursive: false });
        return; // Success
      } catch (error: unknown) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') {
          // Lock is held, backoff and retry
          const backoff = BASE_BACKOFF_MS * 2 ** attempt;
          await this.sleep(backoff);
          continue;
        }
        // Throw unexpected errors immediately
        throw error;
      }
    }
    throw new PendingQueueLockError(
      `Failed to acquire lock on ${this.lockDir} after ${MAX_RETRIES} attempts`,
    );
  }

  private async releaseLock(): Promise<void> {
    try {
      await this.fs.rm(this.lockDir, { recursive: true, force: true });
    } catch {
      // Ignore release errors
    }
  }

  private async readAtomic(): Promise<readonly PendingItem[]> {
    if (!(await this.fs.exists(this.path))) {
      return [];
    }
    try {
      const content = await this.fs.readFile(this.path);
      return JSON.parse(content) as readonly PendingItem[];
    } catch {
      return [];
    }
  }

  private async writeAtomic(items: readonly PendingItem[]): Promise<void> {
    const tempPath = `${this.path}.tmp.${randomUUID()}`;
    await this.fs.mkdir(dirname(this.path), { recursive: true });
    await this.fs.writeFile(tempPath, `${JSON.stringify(items, null, 2)}\n`);
    await this.fs.rename(tempPath, this.path);
  }

  async load(): Promise<readonly PendingItem[]> {
    return this.readAtomic();
  }

  async unacked(): Promise<readonly PendingItem[]> {
    const items = await this.load();
    return items.filter((item) => !item.acked);
  }

  async enqueue(itemInput: Omit<PendingItem, 'id' | 'createdAt' | 'acked'>): Promise<PendingItem> {
    await this.acquireLock();
    try {
      const current = await this.readAtomic();
      const newItem: PendingItem = {
        ...itemInput,
        id: randomUUID(),
        createdAt: this.clock.isoNow(),
        acked: false,
      };
      await this.writeAtomic([...current, newItem]);
      return newItem;
    } finally {
      await this.releaseLock();
    }
  }

  async ack(id: string): Promise<void> {
    await this.acquireLock();
    try {
      const current = await this.readAtomic();
      let changed = false;
      const updated = current.map((item) => {
        if (item.id === id && !item.acked) {
          changed = true;
          return { ...item, acked: true };
        }
        return item;
      });
      if (changed) {
        await this.writeAtomic(updated);
      }
    } finally {
      await this.releaseLock();
    }
  }

  async prune(olderThanMs: number): Promise<number> {
    await this.acquireLock();
    try {
      const current = await this.readAtomic();
      const now = this.clock.now();
      const kept: PendingItem[] = [];
      let prunedCount = 0;

      for (const item of current) {
        if (item.acked) {
          const ageMs = now - new Date(item.createdAt).getTime();
          if (ageMs > olderThanMs) {
            prunedCount++;
            continue;
          }
        }
        kept.push(item);
      }

      if (prunedCount > 0) {
        await this.writeAtomic(kept);
      }
      return prunedCount;
    } finally {
      await this.releaseLock();
    }
  }
}

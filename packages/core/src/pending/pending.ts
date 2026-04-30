import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import type { Clock, FileSystem, Logger, Tier } from '@sentiness/check-sdk';
import { z } from 'zod';

export interface PendingItem {
  readonly id: string;
  readonly jobId: string;
  readonly createdAt: string;
  readonly tier: Tier;
  readonly summary: string;
  readonly reportPath: string;
  readonly acked: boolean;
}

const PendingItemSchema = z.object({
  id: z.string().min(1),
  jobId: z.string().min(1),
  createdAt: z.string().min(1),
  tier: z.enum(['fast', 'standard', 'slow']),
  summary: z.string(),
  reportPath: z.string().min(1),
  acked: z.boolean(),
});

const PendingItemsSchema = z.array(PendingItemSchema);

export class PendingQueueLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PendingQueueLockError';
  }
}

const MAX_RETRIES = 5;
const BASE_BACKOFF_MS = 50;
const STALE_LOCK_TTL_MS = 10 * 60 * 1000; // 10 minutes

const LockOwnerSchema = z.object({
  pid: z.number(),
  acquiredAt: z.string(),
});

export class PendingQueue {
  private readonly lockDir: string;

  constructor(
    private readonly path: string,
    private readonly fs: FileSystem,
    private readonly clock: Clock,
    private readonly logger?: Logger,
  ) {
    this.lockDir = `${path}.lock`;
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'code' in error) {
        return error.code === 'EPERM';
      }
      return false;
    }
  }

  private async isLockStale(): Promise<boolean> {
    try {
      const ownerPath = join(this.lockDir, 'owner');
      if (!(await this.fs.exists(ownerPath))) {
        return true; // No owner file — orphaned lock
      }
      const content = await this.fs.readFile(ownerPath);
      const owner = LockOwnerSchema.safeParse(JSON.parse(content));
      if (!owner.success) {
        return true;
      }
      if (!this.isProcessAlive(owner.data.pid)) {
        return true;
      }
      const ageMs = this.clock.now() - new Date(owner.data.acquiredAt).getTime();
      return ageMs > STALE_LOCK_TTL_MS;
    } catch {
      return true; // Unreadable — assume stale
    }
  }

  private async clearStaleLock(): Promise<void> {
    this.logger?.warn(`Removing stale pending queue lock at ${this.lockDir}`);
    await this.fs.rm(this.lockDir, { recursive: true, force: true });
  }

  private async acquireLock(): Promise<void> {
    const parentDir = dirname(this.lockDir);
    await this.fs.mkdir(parentDir, { recursive: true });

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        await this.fs.mkdir(this.lockDir, { recursive: false });
        // Write owner info so stale detection works if this process dies
        await this.fs.writeFile(
          join(this.lockDir, 'owner'),
          JSON.stringify({ pid: process.pid, acquiredAt: this.clock.isoNow() }),
        );
        return;
      } catch (error: unknown) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') {
          if (await this.isLockStale()) {
            await this.clearStaleLock();
            continue;
          }
          const backoff = BASE_BACKOFF_MS * 2 ** attempt;
          await this.sleep(backoff);
          continue;
        }
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
    } catch (error) {
      this.logger?.warn(`Failed to release pending queue lock at ${this.lockDir}`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async readAtomic(): Promise<readonly PendingItem[]> {
    if (!(await this.fs.exists(this.path))) {
      return [];
    }
    try {
      const content = await this.fs.readFile(this.path);
      return PendingItemsSchema.parse(JSON.parse(content));
    } catch (error) {
      this.logger?.error(`Failed to read pending feedback from ${this.path}`, {
        error: error instanceof Error ? error.message : String(error),
      });
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

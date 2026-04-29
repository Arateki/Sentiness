import type { Clock } from '@sentiness/check-sdk';

export class FixedClock implements Clock {
  constructor(private currentMs = 1_700_000_000_000) {}

  now(): number {
    return this.currentMs;
  }

  isoNow(): string {
    return new Date(this.currentMs).toISOString();
  }

  advance(ms: number): void {
    this.currentMs += ms;
  }
}

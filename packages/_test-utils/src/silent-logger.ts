import type { Logger } from '@sentiness/check-sdk';

export type LogRecord = {
  readonly level: 'debug' | 'info' | 'warn' | 'error';
  readonly message: string;
  readonly fields?: Record<string, unknown>;
};

export class SilentLogger implements Logger {
  readonly records: LogRecord[] = [];

  debug(message: string, fields?: Record<string, unknown>): void {
    this.records.push({ level: 'debug', message, ...(fields ? { fields } : {}) });
  }

  info(message: string, fields?: Record<string, unknown>): void {
    this.records.push({ level: 'info', message, ...(fields ? { fields } : {}) });
  }

  warn(message: string, fields?: Record<string, unknown>): void {
    this.records.push({ level: 'warn', message, ...(fields ? { fields } : {}) });
  }

  error(message: string, fields?: Record<string, unknown>): void {
    this.records.push({ level: 'error', message, ...(fields ? { fields } : {}) });
  }
}

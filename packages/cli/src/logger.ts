import { writeSync } from 'node:fs';
import type { Logger } from '@sentiness/check-sdk';

// A minimal stderr Logger. stdout is reserved for the engine's report JSON, so
// every level goes to fd 2.
export function createLogger(): Logger {
  const emit = (level: string, message: string, fields?: Record<string, unknown>): void => {
    const suffix = fields && Object.keys(fields).length > 0 ? ` ${JSON.stringify(fields)}` : '';
    writeSync(2, `[sentiness:${level}] ${message}${suffix}\n`);
  };
  return {
    debug: (message, fields) => emit('debug', message, fields),
    info: (message, fields) => emit('info', message, fields),
    warn: (message, fields) => emit('warn', message, fields),
    error: (message, fields) => emit('error', message, fields),
  };
}

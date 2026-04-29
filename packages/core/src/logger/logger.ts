import type { Logger } from '@sentiness/check-sdk';

export type LoggerOptions = {
  readonly level: 'debug' | 'info' | 'warn' | 'error';
  readonly stream: NodeJS.WritableStream;
  readonly format: 'pretty' | 'json';
};

type LogLevel = LoggerOptions['level'];

const levels: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function shouldWrite(configured: LogLevel, actual: LogLevel): boolean {
  return levels[actual] >= levels[configured];
}

function mergeFields(
  base: Record<string, unknown>,
  fields: Record<string, unknown> | undefined,
): Record<string, unknown> {
  return fields ? { ...base, ...fields } : { ...base };
}

class StreamLogger implements Logger {
  constructor(
    private readonly options: LoggerOptions,
    private readonly context: Record<string, unknown> = {},
  ) {}

  debug(message: string, fields?: Record<string, unknown>): void {
    this.write('debug', message, fields);
  }

  info(message: string, fields?: Record<string, unknown>): void {
    this.write('info', message, fields);
  }

  warn(message: string, fields?: Record<string, unknown>): void {
    this.write('warn', message, fields);
  }

  error(message: string, fields?: Record<string, unknown>): void {
    this.write('error', message, fields);
  }

  private write(level: LogLevel, message: string, fields?: Record<string, unknown>): void {
    if (!shouldWrite(this.options.level, level)) {
      return;
    }
    const merged = mergeFields(this.context, fields);
    const line =
      this.options.format === 'json'
        ? JSON.stringify({ timestamp: new Date().toISOString(), level, message, ...merged })
        : `${new Date().toISOString()} ${level.toUpperCase()} ${message}${
            Object.keys(merged).length > 0 ? ` ${JSON.stringify(merged)}` : ''
          }`;
    this.options.stream.write(`${line}\n`);
  }

  withContext(fields: Record<string, unknown>): Logger {
    return new StreamLogger(this.options, { ...this.context, ...fields });
  }
}

export function createLogger(options: LoggerOptions): Logger {
  return new StreamLogger(options);
}

export function withContext(base: Logger, fields: Record<string, unknown>): Logger {
  if (base instanceof StreamLogger) {
    return base.withContext(fields);
  }
  return {
    debug: (message, extra) => base.debug(message, mergeFields(fields, extra)),
    info: (message, extra) => base.info(message, mergeFields(fields, extra)),
    warn: (message, extra) => base.warn(message, mergeFields(fields, extra)),
    error: (message, extra) => base.error(message, mergeFields(fields, extra)),
  };
}

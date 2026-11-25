import { LoggerService } from '@nestjs/common';
import { RedactOptions, redactString, redactValue } from './redact';

export type LogLevel = 'log' | 'error' | 'warn' | 'debug' | 'verbose';
export type LogSink = (line: string) => void;

/**
 * JSON-line logger. Every line passes through redaction before it reaches the sink,
 * so redaction happens at the sink and not at the call site (spec 6.8).
 */
export class SafeLogger implements LoggerService {
  constructor(
    private readonly sink: LogSink = (l) => process.stdout.write(`${l}\n`),
    private readonly redact: RedactOptions = {},
  ) {}

  private emit(level: LogLevel, message: unknown, rest: unknown[]): void {
    const entry = {
      time: new Date().toISOString(),
      level,
      message: typeof message === 'string' ? message : redactValue(message, this.redact),
      context: rest.length > 0 ? rest.map((r) => redactValue(r, this.redact)) : undefined,
    };
    // Redact the final serialized line too: a belt-and-braces pass over the exact bytes emitted.
    this.sink(redactString(JSON.stringify(redactValue(entry, this.redact)), this.redact));
  }

  log(message: unknown, ...rest: unknown[]): void {
    this.emit('log', message, rest);
  }
  error(message: unknown, ...rest: unknown[]): void {
    this.emit('error', message, rest);
  }
  warn(message: unknown, ...rest: unknown[]): void {
    this.emit('warn', message, rest);
  }
  debug(message: unknown, ...rest: unknown[]): void {
    this.emit('debug', message, rest);
  }
  verbose(message: unknown, ...rest: unknown[]): void {
    this.emit('verbose', message, rest);
  }
}

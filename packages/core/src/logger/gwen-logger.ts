import type { IGwenLogger, IGwenLogProvider, GwenLogEntry, GwenLogLevel } from '@gwenjs/schema';

const LEVELS: Record<GwenLogLevel, number> = {
  debug: 0, info: 1, warn: 2, error: 3,
};

/**
 * Default `IGwenLogger` implementation.
 *
 * Fan-outs log entries to all registered providers after filtering by `minLevel`.
 * Create child loggers via `child()` to attach scope metadata without allocating a
 * new provider array.
 *
 * Instantiated by `setupGwen` — do not construct directly in application code.
 * Use `useLogger()` from `@gwenjs/kit` instead.
 */
export class GwenLogger implements IGwenLogger {
  constructor(
    private readonly _providers: IGwenLogProvider[],
    private readonly _minLevel: GwenLogLevel,
    private readonly _tag?: string,
    private readonly _entityId?: string,
  ) {}

  debug(message: string, payload?: Record<string, unknown>): void { this._emit('debug', message, payload); }
  info (message: string, payload?: Record<string, unknown>): void { this._emit('info',  message, payload); }
  warn (message: string, payload?: Record<string, unknown>): void { this._emit('warn',  message, payload); }
  error(message: string, payload?: Record<string, unknown>): void { this._emit('error', message, payload); }

  child(tag: string, entityId?: string): IGwenLogger {
    return new GwenLogger(this._providers, this._minLevel, tag, entityId);
  }

  private _emit(level: GwenLogLevel, message: string, payload?: Record<string, unknown>): void {
    if (LEVELS[level] < LEVELS[this._minLevel]) return;
    const entry: GwenLogEntry = {
      level,
      message,
      payload,
      tag:       this._tag,
      entityId:  this._entityId,
      timestamp: performance.now(),
    };
    for (const p of this._providers) p.handle(entry);
  }
}

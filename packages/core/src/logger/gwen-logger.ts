import type { IGwenLogger, IGwenLogProvider, GwenLogEntry, GwenLogLevel } from "@gwenjs/schema";
import { consoleLogProvider } from "./console-log-provider";

const LEVELS: Record<GwenLogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Default `IGwenLogger` implementation.
 *
 * Fan-outs log entries to all registered providers after filtering by `minLevel`.
 * Create child loggers via `child()` to attach scope metadata without allocating a
 * new provider array. A child keeps the providers, the minimum level and the frame getter.
 * An entry includes `frame` only when a frame getter was set. `0` is kept.
 *
 * Application code builds a standalone logger with `createLogger()`.
 * The engine builds its own from `GwenEngineOptions.logger`.
 * Plugin and system code use `useLogger()`.
 */
export class GwenLogger implements IGwenLogger {
  constructor(
    private readonly _providers: readonly IGwenLogProvider[],
    private readonly _minLevel: GwenLogLevel,
    private readonly _tag?: string,
    private readonly _entityId?: string,
    private readonly _getFrame?: () => number,
  ) {}

  debug(message: string, payload?: Record<string, unknown>): void {
    this._emit("debug", message, payload);
  }
  info(message: string, payload?: Record<string, unknown>): void {
    this._emit("info", message, payload);
  }
  warn(message: string, payload?: Record<string, unknown>): void {
    this._emit("warn", message, payload);
  }
  error(message: string, payload?: Record<string, unknown>): void {
    this._emit("error", message, payload);
  }

  child(tag: string, entityId?: string): IGwenLogger {
    return new GwenLogger(this._providers, this._minLevel, tag, entityId, this._getFrame);
  }

  private _emit(level: GwenLogLevel, message: string, payload?: Record<string, unknown>): void {
    if (LEVELS[level] < LEVELS[this._minLevel]) return;
    const entry: GwenLogEntry = {
      level,
      message,
      payload,
      tag: this._tag,
      entityId: this._entityId,
      timestamp: performance.now(),
    };
    if (this._getFrame !== undefined) {
      entry.frame = this._getFrame();
    }
    for (const provider of this._providers) {
      try {
        provider.handle(entry);
      } catch {
        // One provider must not stop the others or crash the engine.
      }
    }
  }
}

export interface CreateLoggerOptions {
  /** Lowest level that is delivered. Default `"warn"`. */
  minLevel?: GwenLogLevel;
  /** Destinations. Default is one console provider. `[]` delivers nothing. */
  providers?: readonly IGwenLogProvider[];
  /** When set, every entry includes `frame`, and `0` is kept. */
  getFrame?: () => number;
}

/** Build a logger for `tag`. Defaults: minimum level `"warn"`, console provider. */
export function createLogger(tag: string, options?: CreateLoggerOptions): IGwenLogger {
  const minLevel = options?.minLevel ?? "warn";
  const providers = options?.providers ?? [consoleLogProvider()];
  return new GwenLogger(providers, minLevel, tag, undefined, options?.getFrame);
}

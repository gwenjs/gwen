/** Severity level for a log entry. Maps directly to `console` methods. */
export type GwenLogLevel = 'debug' | 'info' | 'warn' | 'error';

/** A single structured log entry passed to every registered provider. */
export interface GwenLogEntry {
  /** Severity level. */
  level:     GwenLogLevel;
  /** Human-readable message. */
  message:   string;
  /** Arbitrary structured data attached to this entry. */
  payload?:  Record<string, unknown>;
  /** Scope tag — e.g. `'actor:Player'`, `'plugin:physics2d'`. */
  tag?:      string;
  /** Stringified entityId when the logger was created via `child()` inside an actor scope. */
  entityId?: string;
  /** Timestamp from `performance.now()` at the moment of emission. */
  timestamp: number;
}

/** Receives log entries from `GwenLogger`. Implement to ship logs to any destination. */
export interface IGwenLogProvider {
  handle(entry: GwenLogEntry): void;
}

/** Public logging contract. Obtain an instance via `useLogger()` in `@gwenjs/kit`. */
export interface IGwenLogger {
  debug(message: string, payload?: Record<string, unknown>): void;
  info (message: string, payload?: Record<string, unknown>): void;
  warn (message: string, payload?: Record<string, unknown>): void;
  error(message: string, payload?: Record<string, unknown>): void;
  /**
   * Returns a child logger that prefixes every entry with `tag` and `entityId`.
   * The child shares the same providers and `minLevel` as the parent.
   */
  child(tag: string, entityId?: string): IGwenLogger;
}

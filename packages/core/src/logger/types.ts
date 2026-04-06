/**
 * Log severity levels in ascending order.
 * - `debug` / `info` : only active when `engine.debug === true`
 * - `warn` / `error` : always active regardless of debug mode
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * A single structured log entry produced by {@link GwenLogger}.
 */
export interface LogEntry {
  /** Severity level. */
  level: LogLevel;
  /** Source identifier — typically the plugin name, e.g. `'@gwenjs/physics2d'`. */
  source: string;
  /** Human-readable message. */
  message: string;
  /** Optional key-value context data attached to this entry. */
  data?: Record<string, unknown>;
  /**
   * Engine frame index at the time of emission.
   * `undefined` if emitted outside the frame loop (e.g. during setup).
   */
  frame?: number;
  /** Timestamp from `performance.now()` at the moment of emission. */
  ts: number;
}

/**
 * Structured logger provided by the GWEN engine.
 *
 * Obtain a scoped child logger in any plugin via `engine.logger.child(name)`.
 * Use the child logger instead of `console.*` so output can be redirected,
 * filtered, or forwarded to an external telemetry sink.
 *
 * @example
 * ```typescript
 * setup(engine: GwenEngine) {
 *   const log = engine.logger.child('@gwenjs/my-plugin')
 *   log.debug('initialized', { config })
 * }
 * ```
 */
export interface GwenLogger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;

  /**
   * Create a child logger bound to `source`.
   * All entries emitted by the child carry the given source name.
   *
   * @param source - Identifier for the emitting module, e.g. `'@gwenjs/renderer'`.
   */
  child(source: string): GwenLogger;

  /**
   * Replace the underlying output sink.
   *
   * The default sink writes to `console` when debug mode is active and is a
   * no-op for `debug`/`info` levels in production. Use this to forward logs
   * to Sentry, Datadog, a ring buffer, or a test spy.
   *
   * @param sink - Callback receiving every {@link LogEntry} that passes the level filter.
   */
  setSink(sink: (entry: LogEntry) => void): void;
}

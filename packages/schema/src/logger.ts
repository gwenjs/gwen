/**
 * Structured logger types for GWEN.
 *
 * These types live in `@gwenjs/schema` so plugin authors can reference them
 * in their `setup(engine: GwenEngineBase)` signatures without depending on
 * `@gwenjs/core`.
 *
 * The concrete logger implementation (`createLogger`) stays in `@gwenjs/core`.
 *
 * @module
 */

/**
 * Log severity levels in ascending order of importance.
 *
 * - `debug` / `info`: only active when the engine runs in debug mode.
 * - `warn` / `error`: always active regardless of debug mode.
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * A single structured log entry emitted by a {@link GwenLogger}.
 *
 * Log sinks receive entries of this shape. Useful for forwarding to
 * Sentry, Datadog, a ring buffer, or a test spy via `logger.setSink()`.
 */
export interface LogEntry {
  /** Severity level. */
  level: LogLevel;
  /**
   * Source identifier — typically the plugin or package name.
   * @example `'@gwenjs/physics2d'`
   */
  source: string;
  /** Human-readable message. */
  message: string;
  /** Optional key-value context data attached to this entry. */
  data?: Record<string, unknown> | undefined;
  /**
   * Engine frame index at the time of emission.
   * `undefined` when emitted outside the frame loop (e.g. during `setup()`).
   */
  frame?: number | undefined;
  /** Timestamp from `performance.now()` at the moment of emission. */
  ts: number;
}

/**
 * Structured logger provided by the GWEN engine.
 *
 * Obtain a scoped child logger inside any plugin via `engine.logger.child(name)`.
 * Prefer child loggers over `console.*` so log output can be filtered, redirected,
 * or forwarded to an external telemetry sink.
 *
 * @example
 * ```ts
 * import type { GwenEngineBase } from '@gwenjs/schema'
 *
 * setup(engine: GwenEngineBase) {
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
   * All entries emitted by the child carry the given source identifier.
   *
   * @param source - Identifier for the emitting module, e.g. `'@gwenjs/renderer'`.
   */
  child(source: string): GwenLogger;

  /**
   * Replace the underlying output sink.
   *
   * The default sink writes to `console` when debug mode is active and is a
   * no-op for `debug`/`info` entries in production. Use this in tests to capture
   * log output, or in production to forward logs to an external service.
   *
   * @param sink - Callback that receives every {@link LogEntry} passing the level filter.
   */
  setSink(sink: (entry: LogEntry) => void): void;
}

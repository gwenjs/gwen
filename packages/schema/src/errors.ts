/**
 * Base error class and error-bus contract for the GWEN framework.
 *
 * `GwenError` is defined here so any package can do `instanceof GwenError`
 * without importing from `@gwenjs/core`. This avoids circular imports between
 * packages that produce GWEN errors and packages that catch them.
 *
 * @module
 */

/**
 * Base class for all GWEN framework errors.
 *
 * Every built-in error class (`GwenPluginNotFoundError`, `GwenActorError`,
 * `GwenComposableError`, `GwenConfigError`, …) extends this class, so you can
 * catch any GWEN error with a single `instanceof GwenError` check across
 * package boundaries without importing from `@gwenjs/core`.
 *
 * @example Catch any GWEN error:
 * ```ts
 * import { GwenError } from '@gwenjs/schema'
 *
 * try {
 *   engine.inject('missingService')
 * } catch (e) {
 *   if (e instanceof GwenError) {
 *     console.error(`[${e.code}] ${e.message}`)
 *   }
 * }
 * ```
 *
 * @example Extend for your own plugin errors:
 * ```ts
 * import { GwenError } from '@gwenjs/schema'
 *
 * export class AudioPluginError extends GwenError {
 *   constructor(message: string) {
 *     super('AUDIO:ERROR', message)
 *     this.name = 'AudioPluginError'
 *   }
 * }
 * ```
 */
export class GwenError extends Error {
  /**
   * Machine-readable error code in `NAMESPACE:REASON` format.
   * @example `'GWEN_PLUGIN_NOT_FOUND'`, `'CORE:WASM_LOAD_ERROR'`
   */
  public readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "GwenError";
    this.code = code;
  }
}

/**
 * Severity level for structured error payloads.
 *
 * - `fatal` — engine cannot continue; stop() will be called.
 * - `error` — recoverable problem; frame continues.
 * - `warning` — degraded behaviour; no action required.
 * - `info` — informational, not a problem.
 * - `verbose` — fine-grained diagnostic, typically disabled in production.
 */
export type GwenErrorLevel = "fatal" | "error" | "warning" | "info" | "verbose";

/**
 * Structured error payload emitted through {@link GwenErrorBusBase}.
 *
 * Plugins emit payloads (not raw `Error` objects) so monitoring pipelines
 * can process structured data. The optional `error` field carries the original
 * thrown value when one exists.
 */
export interface GwenErrorPayload {
  /** Severity of this event. */
  level: GwenErrorLevel;
  /** Machine-readable code identifying the error type. */
  code: string;
  /** Human-readable description. */
  message: string;
  /** The package or system that produced this event (e.g. `'@gwenjs/physics2d'`). */
  source?: string;
  /** Original thrown value, if any. */
  error?: unknown;
  /** Arbitrary key-value data for debugging (frame number, entity id, …). */
  context?: Record<string, unknown>;
}

/**
 * Minimal engine-level error bus interface.
 *
 * Defined in schema so plugin authors can emit structured errors through the
 * bus without depending on `@gwenjs/core`. The concrete `GwenErrorBus` class
 * in `@gwenjs/kit` satisfies this interface.
 *
 * Obtain it inside `plugin.setup()` via `engine.tryInject('errors')` — it may
 * be absent if the consumer did not provide an error bus at `createEngine()`.
 *
 * @example Inside a plugin:
 * ```ts
 * import type { GwenErrorBusBase } from '@gwenjs/schema'
 *
 * setup(engine) {
 *   const errors = engine.tryInject('errors') as GwenErrorBusBase | undefined
 *   errors?.emit({ level: 'warning', code: 'AUDIO:NO_CONTEXT', message: 'AudioContext missing' })
 * }
 * ```
 */
export interface GwenErrorBusBase {
  /**
   * Emit a structured error event.
   * If `payload.level === 'fatal'`, all `onFatal` callbacks will be invoked.
   */
  emit(payload: GwenErrorPayload): void;

  /**
   * Register a callback to invoke when a fatal error is emitted.
   * Use this to trigger engine shutdown or display a crash screen.
   */
  onFatal(cb: () => void): void;
}

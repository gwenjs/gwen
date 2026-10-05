/**
 * Build-time dev flag. Vitest, `@gwenjs/vite`, and package lib builds supply the value.
 * Runtime code reads the identifier only inside an allowed gate.
 */
declare global {
  const __GWEN_DEV__: boolean;
}

/**
 * Base error class and error-bus contract for the GWEN framework.
 *
 * `GwenError` is defined here so any package can do `instanceof GwenError`
 * without importing from `@gwenjs/core`. This avoids circular imports between
 * packages that produce GWEN errors and packages that catch them.
 *
 * @module
 */

import type { GwenScopeType } from "./scope.js";

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
/**
 * Options for a {@link GwenError}. `hint` is `string | undefined` so a prod
 * ternary (`__GWEN_DEV__ ? "…" : undefined`) typechecks under exactOptionalPropertyTypes.
 * Hint text is written inline at the call site. This class does not read the flag.
 */
export interface GwenErrorOptions {
  composable?: string;
  hint?: string | undefined;
  cause?: unknown;
}

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
 * - `fatal` — the engine moves to `faulted` and the loop stops. `stop()` is not called.
 * - `error` — the frame continues. A `target`, when present, is isolated.
 * - `warning` — degraded behaviour; no action required.
 * - `info` — informational, not a problem.
 * - `verbose` — fine-grained diagnostic, typically disabled in production.
 */
export type GwenErrorLevel = "fatal" | "error" | "warning" | "info" | "verbose";

/**
 * Owner of a caught failure. Set whenever the engine can name who threw.
 * `reenable(id)` clears isolation for `id`.
 */
export interface GwenErrorTarget {
  /** Who failed. */
  kind: GwenScopeType | "wasm-module";
  /**
   * Stable key. Scope meta id (`"system#3"`) for a system, actor, or scene.
   * Plugin name for a plugin. `"wasm:<name>"` for a community module.
   */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Set for actor targets. */
  entityId?: bigint;
}

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
  /** Owner of the failure, when the engine could identify it. */
  target?: GwenErrorTarget;
}

/**
 * Minimal engine-level error bus interface.
 *
 * Defined in schema so plugin authors can emit structured errors through the
 * bus without depending on `@gwenjs/core`. `createErrorBus()` in `@gwenjs/core`
 * implements this interface and is re-exported from `@gwenjs/kit`.
 *
 * `createEngine()` always registers a bus. A caller can still pass their own
 * via the `errorBus` option. Read it inside `plugin.setup()` with
 * `engine.tryInject('errors')`.
 *
 * @example Inside a plugin:
 * ```ts
 * import type { GwenErrorBusBase } from '@gwenjs/schema'
 *
 * setup(engine) {
 *   const errors = engine.tryInject('errors') as GwenErrorBusBase
 *   errors.emit({ level: 'warning', code: 'AUDIO:NO_CONTEXT', message: 'AudioContext missing' })
 * }
 * ```
 */
export interface GwenErrorBusBase {
  /**
   * Emit a structured error event.
   * Every `on` handler runs synchronously.
   * When `payload.level === 'fatal'`, every `onFatal` callback runs after those handlers, still inside `emit`.
   * A handler that throws is caught. The other handlers still run.
   */
  emit(payload: GwenErrorPayload): void;

  /**
   * Register a handler invoked for every emitted event, including fatal ones.
   * Required. A custom bus passed as `errorBus` must implement it.
   * `onFatal` callbacks run after these handlers.
   * @returns Unsubscribe. Removing the handler stops later events from reaching it.
   */
  on(handler: (payload: GwenErrorPayload) => void): () => void;

  /**
   * Register a callback to invoke when a fatal error is emitted.
   * Use this to show a crash screen or call `engine.stop()` yourself.
   * The default engine does not register a callback that tears the engine down.
   * Runs after `on` handlers, synchronously inside `emit`.
   * @returns Unsubscribe.
   */
  onFatal(cb: () => void): () => void;
}

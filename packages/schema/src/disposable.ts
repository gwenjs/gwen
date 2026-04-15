/**
 * Disposable pattern for GWEN — interfaces only.
 *
 * Concrete implementations live in `@gwenjs/core` (`createDisposable`,
 * `DisposableRegistry`). These interfaces are in schema so plugin authors
 * and kit consumers can reference them without depending on `@gwenjs/core`.
 *
 * @module
 */

/**
 * A one-shot, idempotent cleanup handle.
 *
 * Implements TC39 Explicit Resource Management (`Symbol.dispose`), so it can
 * be used with `using` declarations in TypeScript 5.2+.
 *
 * - `dispose()` executes the cleanup callback exactly once. Subsequent calls
 *   are silent no-ops.
 * - `disposed` becomes `true` after the first `dispose()` call.
 * - `Symbol.dispose` delegates to `dispose()` for `using` block support.
 *
 * @example Obtain one from createDisposable() in @gwenjs/core:
 * ```ts
 * import { createDisposable } from '@gwenjs/core'
 * const d = createDisposable(() => socket.close())
 * d.dispose()          // closes the socket
 * d.dispose()          // no-op — already disposed
 * d.disposed           // true
 * ```
 *
 * @example Using block (TypeScript 5.2+):
 * ```ts
 * {
 *   using d = createDisposable(() => resource.release())
 *   // resource is released when the block exits
 * }
 * ```
 */
export interface GwenDisposable {
  /** `true` after the first `dispose()` call. Subsequent calls are no-ops. */
  readonly disposed: boolean;

  /**
   * Run the cleanup callback. Idempotent — safe to call multiple times.
   * Only the first call has any effect.
   */
  dispose(): void;

  /**
   * TC39 Explicit Resource Management entry point.
   * Delegates to `dispose()`. Called automatically by `using` declarations.
   */
  [Symbol.dispose](): void;
}

/**
 * Named registry of {@link GwenDisposable} instances.
 *
 * Disposables are released in **LIFO order** (last registered = first disposed),
 * which mirrors the natural dependency order: the last resource acquired is
 * typically the safest to release first.
 *
 * The concrete class (`DisposableRegistry`) lives in `@gwenjs/core`.
 * This interface is in schema so `GwenEngineBase` can reference it without
 * pulling in the full engine implementation.
 *
 * @example
 * ```ts
 * // Inside a plugin setup():
 * const timer = setInterval(tick, 100)
 * engine.disposables.add('tick-timer', createDisposable(() => clearInterval(timer)))
 * // Automatically cleared when engine.teardown() runs.
 * ```
 */
export interface DisposableRegistryBase {
  /**
   * Register a named disposable. The name is used for debugging only —
   * there is no uniqueness constraint.
   *
   * @param name - Human-readable label for this resource (e.g. `'tick-timer'`).
   * @param disposable - The disposable to register.
   */
  add(name: string, disposable: GwenDisposable): void;

  /**
   * Dispose all registered disposables in LIFO order, then clear the registry.
   * Safe to call on an empty registry.
   */
  disposeAll(): void;

  /** Number of disposables currently registered. */
  readonly size: number;
}

/**
 * Concrete implementations of the GwenDisposable pattern.
 *
 * `createDisposable` wraps any cleanup function in a one-shot,
 * idempotent handle. `DisposableRegistry` manages a named LIFO stack
 * of those handles, used internally by the engine for deterministic teardown.
 *
 * @module
 */

import type { GwenDisposable, DisposableRegistryBase } from "@gwenjs/schema";

/**
 * Wrap a cleanup function in a one-shot, idempotent {@link GwenDisposable}.
 *
 * - `dispose()` runs `fn` exactly once. Every subsequent call is a no-op.
 * - `disposed` becomes `true` after the first call.
 * - `Symbol.dispose` delegates to `dispose()` for `using` block support.
 *
 * @param fn - Cleanup callback to run on first `dispose()`.
 * @returns A new `GwenDisposable` wrapping `fn`.
 *
 * @example
 * ```ts
 * import { createDisposable } from '@gwenjs/core/internal'
 *
 * const timer = setInterval(tick, 100)
 * const d = createDisposable(() => clearInterval(timer))
 *
 * // Inside a plugin:
 * engine.disposables.add('tick-timer', d)
 * // Automatically called during engine.teardown() in LIFO order.
 * ```
 */
export function createDisposable(fn: () => void): GwenDisposable {
  let disposed = false;
  return {
    get disposed(): boolean {
      return disposed;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      fn();
    },
    [Symbol.dispose](): void {
      this.dispose();
    },
  };
}

/**
 * Named, LIFO registry of {@link GwenDisposable} instances.
 *
 * Resources are disposed in **reverse registration order** — the last
 * resource registered is the first to be released. This matches the natural
 * dependency order: later-acquired resources often depend on earlier ones.
 *
 * Used by the engine to manage all plugin-level resources. Plugin authors
 * register resources via `engine.disposables.add(name, createDisposable(fn))`
 * in `setup()` instead of implementing `teardown()` manually.
 *
 * @example
 * ```ts
 * const registry = new DisposableRegistry()
 *
 * registry.add('ws', createDisposable(() => socket.close()))
 * registry.add('timer', createDisposable(() => clearInterval(id)))
 *
 * registry.disposeAll()
 * // Runs: timer cleanup, then ws cleanup (LIFO)
 * ```
 */
export class DisposableRegistry implements DisposableRegistryBase {
  private readonly _stack: Array<{ name: string; d: GwenDisposable }> = [];

  /**
   * Register a named disposable.
   *
   * The name is for debugging only — no uniqueness constraint is enforced.
   * Duplicate names are allowed.
   *
   * @param name - Human-readable label for this resource.
   * @param disposable - The resource handle to register.
   */
  add(name: string, disposable: GwenDisposable): void {
    this._stack.push({ name, d: disposable });
  }

  /**
   * Dispose all registered resources in LIFO order, then clear the registry.
   *
   * Each disposable's `dispose()` is called exactly once (subsequent
   * `disposeAll()` calls on an empty registry are safe no-ops).
   */
  disposeAll(): void {
    for (let i = this._stack.length - 1; i >= 0; i--) {
      this._stack[i].d.dispose();
    }
    this._stack.length = 0;
  }

  /** Number of disposables currently registered. */
  get size(): number {
    return this._stack.length;
  }
}

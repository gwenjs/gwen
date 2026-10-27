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
  private _closed = false;

  /**
   * True once {@link disposeAll} has started. A later `add` is not disposed by
   * that run (`engine.stop()` disposes once).
   */
  get closed(): boolean {
    return this._closed;
  }

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
   * Dispose all registered resources in LIFO order.
   *
   * The stack is copied and cleared before any `dispose()` runs, so a second
   * call does not retry. Every entry still runs when an earlier one throws.
   * The first error is rethrown after the loop.
   */
  disposeAll(): void {
    this._closed = true;
    const stack = this._stack.splice(0);
    let firstError: unknown;
    let failed = false;
    for (let i = stack.length - 1; i >= 0; i--) {
      const entry = stack[i];
      if (entry === undefined) continue;
      try {
        entry.d.dispose();
      } catch (error: unknown) {
        if (!failed) {
          firstError = error;
          failed = true;
        }
      }
    }
    if (failed) throw firstError;
  }

  /** Number of disposables currently registered. */
  get size(): number {
    return this._stack.length;
  }
}

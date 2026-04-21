/**
 * @file ScopedHookable — lifecycle-scoped hook subscription manager.
 *
 * Wraps a parent `Hookable<GwenRuntimeHooks>` (typically `engine.hooks`) and
 * adds pause/resume/dispose semantics. Each actor instance, system factory
 * call, and scene owns one `ScopedHookable`. Pausing a scope silences all its
 * registered handlers without unregistering them — used by actor pools to
 * implement dormancy with zero per-handler overhead.
 *
 * Phase 5 (GwenScope unified): The legacy `_currentScopeSlot` has been removed.
 * Composables like `onUpdate()` now use `GwenScope.current()` directly.
 *
 * @module
 */

import type { Hookable } from "hookable";
import type { GwenRuntimeHooks } from "@gwenjs/schema";

// ─── ScopedHookable ───────────────────────────────────────────────────────────

/**
 * A lifecycle-scoped wrapper around a parent `Hookable<GwenRuntimeHooks>`.
 *
 * Handlers registered via {@link hook} are:
 * - **Silenced** (not invoked) while the scope is {@link pause paused}.
 * - **Unregistered** from the parent bus when the scope is {@link dispose disposed}.
 *
 * One `ScopedHookable` is created per actor instance (during `spawn`), per
 * system factory invocation (during `defineSystem` setup), and per scene
 * (during `defineScene` setup). This makes pool dormancy, scene deactivation,
 * and full cleanup a single method call instead of per-handler bookkeeping.
 *
 * @example
 * ```ts
 * const scope = new ScopedHookable(engine.hooks);
 *
 * scope.hook("engine:update", (dt) => { move(dt); });
 * scope.hook("engine:render", () => { draw(); });
 *
 * scope.pause();   // silences both handlers — no allocations
 * scope.resume();  // re-enables both handlers
 * scope.dispose(); // unregisters both from engine.hooks
 * ```
 */
export class ScopedHookable {
  /** When `true`, all registered handlers are skipped on dispatch. */
  private _paused = false;

  /**
   * Unsubscribe functions returned by `parent.hook()`.
   * Calling each one removes the wrapped handler from the parent bus.
   */
  private _disposers: (() => void)[] = [];

  /**
   * @param _parent - The parent hook bus to subscribe to (usually `engine.hooks`).
   */
  constructor(private readonly _parent: Hookable<GwenRuntimeHooks>) {}

  /**
   * Subscribe to a hook on the parent bus.
   *
   * The handler is wrapped in a dormancy guard: if this scope is paused when
   * the hook fires, the handler is silently skipped. The wrapper preserves the
   * original handler's type signature so TypeScript still verifies call-site
   * argument types.
   *
   * @param name - The hook name (key of {@link GwenRuntimeHooks}).
   * @param fn   - The handler to invoke when the hook fires.
   * @returns An unsubscribe function. Call it to remove this handler early,
   *   before the scope is disposed.
   */
  hook<K extends keyof GwenRuntimeHooks>(name: K, fn: GwenRuntimeHooks[K]): () => void {
    const wrapped = ((...args: Parameters<GwenRuntimeHooks[K]>) => {
      if (this._paused) return;
      return (fn as (...a: Parameters<GwenRuntimeHooks[K]>) => unknown)(...args);
    }) as GwenRuntimeHooks[K];

    const unsub = this._parent.hook(name, wrapped as never);
    this._disposers.push(unsub);

    return () => {
      unsub();
      const idx = this._disposers.indexOf(unsub);
      if (idx !== -1) this._disposers.splice(idx, 1);
    };
  }

  /**
   * Pause this scope. All handlers registered via {@link hook} will be skipped
   * when their parent hook fires. The handlers remain registered — call
   * {@link resume} to re-enable them.
   *
   * Used by actor pools to implement dormancy: `pool.release(id)` calls
   * `scope.pause()` on the actor's scope.
   */
  pause(): void {
    this._paused = true;
  }

  /**
   * Resume this scope after a {@link pause} call. All handlers become active
   * again on the next dispatch.
   *
   * Used by actor pools when re-acquiring a dormant slot: `pool.acquire()`
   * calls `scope.resume()` on the actor's scope.
   */
  resume(): void {
    this._paused = false;
  }

  /**
   * Returns `true` if this scope is currently paused.
   */
  get paused(): boolean {
    return this._paused;
  }

  /**
   * Dispose this scope. Unregisters all handlers from the parent bus and
   * clears internal state. Idempotent — safe to call multiple times.
   *
   * Called during actor despawn, scene teardown, and system removal.
   */
  dispose(): void {
    for (const unsub of this._disposers) unsub();
    this._disposers = [];
  }
}

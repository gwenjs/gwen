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
import type { GwenRuntimeHookName, GwenRuntimeHooks } from "@gwenjs/schema";
import { assertHookName } from "./hook-name.js";

// ─── Hook slots ───────────────────────────────────────────────────────────────

/**
 * One handler registered on the parent bus. The bus holds a wrapper that reads `owner` and
 * `call` on every dispatch, so a hot swap re-targets the slot in place and the handler keeps
 * its position on the bus.
 */
interface HookSlot {
  owner: ScopedHookable;
  call: (...args: unknown[]) => unknown;
  readonly name: string;
  unsub: () => void;
}

/** Slots handed from one scope to the next, grouped by hook name in registration order. */
export type HookSlots = Map<string, HookSlot[]>;

/** Stands in for a slot whose scope was swapped out and has no replacement yet. */
function noop(): void {}

/** Remove every slot from the parent bus. */
export function releaseSlots(slots: HookSlots): void {
  for (const list of slots.values()) for (const slot of list) slot.unsub();
}

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

  /** Drops this scope's isolation entry. Does not unregister handlers. @internal */
  private _forgetIsolation: (() => void) | null = null;

  /** Slots this scope owns. Each holds the unsubscribe function returned by `parent.hook()`. */
  private _slots: HookSlot[] = [];

  /** Slots of a swapped-out scope not yet re-used, by hook name. Null for a cold scope. */
  private _adopt: HookSlots | null;

  /** How many slots of each hook name this scope has re-used so far. */
  private readonly _taken = new Map<string, number>();

  /**
   * @param _parent - The parent hook bus to subscribe to (usually `engine.hooks`).
   * @param adopt - Slots of a scope being hot-swapped. The n-th handler this scope registers for
   *   a hook name re-uses the n-th slot of that name instead of appending to the bus.
   */
  constructor(
    private readonly _parent: Hookable<GwenRuntimeHooks>,
    adopt?: HookSlots,
  ) {
    this._adopt = adopt ?? null;
  }

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
  hook<K extends GwenRuntimeHookName>(name: K, fn: GwenRuntimeHooks[K]): () => void {
    assertHookName(name, "scope.hook", false);
    const call = fn as (...args: unknown[]) => unknown; // boundary: the wrapper below calls fn with arguments of unknown type, where fn is typed for hook K
    const reused = this._reuse(name, call);
    if (reused !== null) return this._release(reused);

    const slot: HookSlot = { owner: this, call, name, unsub: noop };
    // Arity 0-4 stays allocation-free. A longer call uses apply.
    const wrapped = function (a: unknown, b: unknown, c: unknown, d: unknown) {
      if (slot.owner._paused) return;
      const fire = slot.call;
      if (arguments.length > 4) return Function.prototype.apply.call(fire, undefined, arguments);
      if (d !== undefined) return fire(a, b, c, d);
      if (c !== undefined) return fire(a, b, c);
      if (b !== undefined) return fire(a, b);
      if (a !== undefined) return fire(a);
      return fire();
    };

    slot.unsub = this._parent.hook(name, wrapped as never); // boundary: wrapped is the arity-dispatching untyped function; hook() wants the callback typed for hook K
    this._slots.push(slot);
    return this._release(slot);
  }

  /**
   * The unsubscribe function of one slot: leaves the bus and this scope. A no-op once this
   * scope no longer owns the slot (disposed, or handed to the next scope of a hot swap).
   */
  private _release(slot: HookSlot): () => void {
    return () => {
      const idx = this._slots.indexOf(slot);
      if (idx === -1) return;
      this._slots.splice(idx, 1);
      slot.unsub();
    };
  }

  /** Take the next slot of `name` from the swapped-out scope and point it here, or null. */
  private _reuse(name: string, call: (...args: unknown[]) => unknown): HookSlot | null {
    const list = this._adopt?.get(name);
    if (list === undefined) return null;
    const index = this._taken.get(name) ?? 0;
    const slot = list[index];
    if (slot === undefined) return null;
    this._taken.set(name, index + 1);
    slot.owner = this;
    slot.call = call;
    this._slots.push(slot);
    return slot;
  }

  /**
   * End of a hot swap that ran its setup. Remove the adopted slots this scope did not re-use:
   * the new body registers fewer handlers than the old one.
   * @internal
   */
  finishAdopt(): void {
    const adopt = this._adopt;
    this._adopt = null;
    if (adopt === null) return;
    for (const [name, list] of adopt) {
      for (let i = this._taken.get(name) ?? 0; i < list.length; i++) list[i]?.unsub();
    }
  }

  /**
   * Give the slots away without unhooking them, so `dispose()` leaves them on the bus for the
   * next scope. Slots of the swapped-out scope that were never re-used come back too.
   * @internal
   */
  handOff(): HookSlots {
    const out: HookSlots = new Map();
    for (const slot of this._slots) {
      const list = out.get(slot.name);
      if (list === undefined) out.set(slot.name, [slot]);
      else list.push(slot);
    }
    for (const [name, list] of this._adopt ?? []) {
      const kept = out.get(name) ?? [];
      out.set(name, kept.concat(list.slice(this._taken.get(name) ?? 0)));
    }
    this._slots = [];
    this._adopt = null;
    return out;
  }

  /**
   * A swap whose new setup threw: every slot is silenced and handed over, so a later swap
   * restores the same bus positions.
   * @internal
   */
  park(): HookSlots {
    const slots = this.handOff();
    for (const list of slots.values()) for (const slot of list) slot.call = noop;
    return slots;
  }

  /** @internal Wire the engine callback that drops this scope's isolation entry. */
  setIsolationForget(forget: () => void): void {
    this._forgetIsolation = forget;
  }

  /**
   * Drop this scope's isolation entry without unregistering handlers.
   * Pool `release()` calls this. `dispose()` calls it too.
   * @internal
   */
  forgetIsolation(): void {
    this._forgetIsolation?.();
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
    this.forgetIsolation();
    for (const slot of this._slots) slot.unsub();
    this._slots = [];
  }
}

/**
 * A typed, nestable context slot.
 *
 * Encapsulates the save/restore pattern used throughout the engine to pass
 * implicit context to composables (`_withSystemContext`, `_withLayoutContext`,
 * `_withActorContext`). Using a shared primitive ensures every context slot
 * behaves identically and re-entrant calls are always safe.
 *
 * @template T - The type of value stored in this slot.
 *
 * @example
 * ```ts
 * const _ctx = new ContextSlot<MyContext>();
 *
 * export function _withMyContext<R>(value: MyContext, fn: () => R): R {
 *   return _ctx.run(value, fn);
 * }
 * export function _getMyContext(): MyContext {
 *   return _ctx.require('[GWEN] must be called inside _withMyContext()');
 * }
 * ```
 */
export class ContextSlot<T> {
  private _current: T | null = null;

  /**
   * Run `fn` with `value` as the active slot value, then restore the previous
   * value. Safe to call re-entrantly — the previous value is always restored
   * in the `finally` block even if `fn` throws.
   *
   * @param value - The context value to activate for the duration of `fn`.
   * @param fn    - The function to run inside the context.
   * @returns The return value of `fn`.
   */
  run<R>(value: T, fn: () => R): R {
    const prev = this._current;
    this._current = value;
    try {
      return fn();
    } finally {
      this._current = prev;
    }
  }

  /**
   * Returns the currently active value, or `null` if outside a {@link run} call.
   */
  get(): T | null {
    return this._current;
  }

  /**
   * Returns the active value or throws if the slot is empty.
   *
   * @param errorMsg - Message for the thrown `Error` when called outside a `run()`.
   * @throws {Error} When called outside an active `run()` call.
   */
  require(errorMsg: string): T {
    if (this._current === null) throw new Error(errorMsg);
    return this._current;
  }

  /**
   * Returns `true` if currently inside a {@link run} call.
   */
  isActive(): boolean {
    return this._current !== null;
  }
}

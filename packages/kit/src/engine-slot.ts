/**
 * @file Module slot for the active engine.
 *
 * One module binding, no `globalThis`. Core re-exports this slot as
 * `engineContext`. Plugin authors read it through {@link tryUseEngine}.
 */

import type { GwenEngineBase } from "@gwenjs/schema";

let current: GwenEngineBase | undefined;

/**
 * The engine `useEngine()` returns in this place, or `undefined` where
 * that call throws `CORE:OUTSIDE_ENGINE_CONTEXT`. Never throws.
 */
export function tryUseEngine(): GwenEngineBase | undefined {
  return current;
}

/**
 * Synchronous engine slot.
 *
 * `set` replaces the current engine. Callers pass the literal `true`.
 */
export interface EngineSlot<E extends GwenEngineBase = GwenEngineBase> {
  /** The engine in the slot, or `undefined` when the slot is empty. */
  tryUse(): E | undefined;
  /** Store `engine`. `replace` is always the literal `true`. */
  set(engine: E, replace: true): void;
  /** Clear the slot. */
  unset(): void;
}

/** @internal Engine use only (core re-exports it as engineContext). */
export const _engineSlot: EngineSlot = {
  tryUse() {
    return current;
  },
  set(engine) {
    current = engine;
  },
  unset() {
    current = undefined;
  },
};

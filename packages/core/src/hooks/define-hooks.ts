import type { HookHandlerMap, HookMapKeyErrors } from "@gwenjs/schema";
import { assertHookName } from "./hook-name.js";

export type { HookHandlerMap, InferHooks } from "@gwenjs/schema";

// `const` infers readonly keys. The returned object is the same mutable map.
type WritableHookMap<T> = { -readonly [K in keyof T]: T[K] };

/**
 * Declare a typed set of custom game hooks.
 *
 * Returns the same object at runtime.
 * A malformed or reserved key throws `GwenHookNameError` before the return.
 * A framework namespace (`camera`, `viewport`, `physics`, `physics3d`) is a compile error
 * and does not throw. Pair with `InferHooks` and declaration merging.
 * A string index skips the compile-time key check. The runtime loop still rejects it.
 *
 * @example
 * ```ts
 * // src/hooks.ts
 * import { defineHooks } from '@gwenjs/core'
 *
 * export const GameHooks = defineHooks({
 *   'enemy:died': (_id: bigint): void => undefined,
 *   'player:damage': (_amount: number): void => undefined,
 * })
 *
 * declare module '@gwenjs/schema' {
 *   interface GwenRuntimeHooks extends InferHooks<typeof GameHooks> {}
 * }
 * ```
 */
export function defineHooks<const T extends HookHandlerMap>(
  map: string extends keyof T ? T : T & HookMapKeyErrors<T>,
): WritableHookMap<T> {
  for (const key in map) assertHookName(key, "defineHooks", true);
  return map as WritableHookMap<T>;
}

import type { HookHandlerMap } from "@gwenjs/schema";

export type { HookHandlerMap, InferHooks } from "@gwenjs/schema";

/**
 * Declare a typed set of custom game hooks.
 *
 * Returns the same object unchanged at runtime (identity function).
 * The value is its TypeScript signature — pair with `InferHooks` and
 * declaration merging to register your hooks in `GwenRuntimeHooks`
 * for full type-safety in `useHook` / `emit`.
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
export function defineHooks<T extends HookHandlerMap>(map: T): T {
  return map;
}

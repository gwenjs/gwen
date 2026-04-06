/**
 * @file defineEvents — declare typed custom game events
 *
 * @example
 * ```ts
 * // src/events.ts
 * export const GameEvents = defineEvents({
 *   'enemy:died': (id: bigint): void => undefined,
 *   'player:damage': (amount: number): void => undefined,
 * })
 *
 * declare module '@gwenjs/core' {
 *   interface GwenRuntimeHooks extends InferEvents<typeof GameEvents> {}
 * }
 * ```
 */

/** A map of event names to handler functions. */
export type EventHandlerMap = Record<string, (...args: never[]) => void>;

/**
 * Maps an `EventHandlerMap` created with `defineEvents` into a shape that
 * can be used to augment `GwenRuntimeHooks`.
 */
export type InferEvents<T extends EventHandlerMap> = {
  [K in keyof T]: T[K];
};

/**
 * Declare a typed set of custom game events.
 *
 * Returns the same object unchanged at runtime (identity function).
 * The value is its TypeScript signature — pair with `InferEvents` to
 * augment `GwenRuntimeHooks` and get full type-safety in `emit` / `onEvent`.
 */
export function defineEvents<T extends EventHandlerMap>(map: T): T {
  return map;
}

/** A map of hook names to handler function types. */
export type HookHandlerMap = Record<string, (...args: never[]) => void>;

/**
 * Maps a `HookHandlerMap` created with `defineHooks` into a shape compatible
 * with `GwenRuntimeHooks` declaration merging.
 *
 * @example
 * ```ts
 * type MyHooks = InferHooks<typeof GameHooks>
 * // { 'enemy:died': (id: bigint) => void; 'player:damage': (amount: number) => void }
 * ```
 */
export type InferHooks<T extends HookHandlerMap> = {
  [K in keyof T]: T[K];
};

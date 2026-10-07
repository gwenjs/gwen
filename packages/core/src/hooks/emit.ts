/**
 * @file `emit()` — sugar over `engine.hooks.callHook`.
 *
 * Lets you fire engine/game events from anywhere that has an active engine
 * context (inside `defineSystem`, `defineActor` factory, or an engine
 * lifecycle callback) without needing to hold a reference to the engine.
 */

import { useEngine } from "../engine/context";
import type { GwenRuntimeHooks } from "../engine/runtime-hooks";
import { reportRejectedHook } from "./report-rejected-hook.js";

/**
 * Emits a named event via the engine's hookable system.
 *
 * Sugar over `engine.hooks.callHook(name, ...args)`. All hooks registered
 * with `engine.hooks.hook(name, fn)` for the given event name will be called
 * synchronously in registration order.
 *
 * Must be called within an active engine context (inside `defineSystem`,
 * a `defineActor` factory, or an engine lifecycle callback such as
 * `onUpdate`). Throws with a `[GWEN]`-prefixed message if called outside
 * any active context.
 *
 * **Known hooks** (declared in {@link GwenRuntimeHooks}) are fully typed —
 * arguments are inferred automatically. An event name that is not declared
 * is a compile error. Augment `GwenRuntimeHooks` via declaration merging:
 *
 * ```typescript
 * declare module '@gwenjs/schema' {
 *   interface GwenRuntimeHooks {
 *     'player:damage': (amount: number) => void
 *   }
 * }
 * ```
 *
 * @throws {GwenContextError} If called outside an active engine context.
 *
 * @example Known hook — args are fully typed:
 * ```typescript
 * emit('engine:tick', 0.016) // ✅ dt: number
 * ```
 *
 * @example Custom game event — declare it, then emit with no type argument:
 * ```typescript
 * emit('player:damage', 25)
 * ```
 */
export function emit<K extends keyof GwenRuntimeHooks>(
  name: K,
  ...args: Parameters<GwenRuntimeHooks[K]>
): void {
  const engine = useEngine();
  reportRejectedHook(engine, "emit", String(name), engine.hooks.callHook(name, ...args));
}

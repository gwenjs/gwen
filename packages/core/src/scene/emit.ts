/**
 * @file `emit()` — sugar over `engine.hooks.callHook` for RFC-011 Actor System.
 *
 * Lets you fire engine/game events from anywhere that has an active engine
 * context (inside `defineSystem`, `defineActor` factory, or an engine
 * lifecycle callback) without needing to hold a reference to the engine.
 */

import { useEngine } from '../context.js';
import type { GwenRuntimeHooks } from '../engine/runtime-hooks.js';

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
 * arguments are inferred automatically. **Custom game events** (e.g.
 * `'enemy:died'`, `'player:damage'`) are accepted as plain strings without
 * any cast. To get argument type-checking for custom events, augment
 * `GwenRuntimeHooks` in your project:
 *
 * ```typescript
 * declare module '@gwenjs/core' {
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
 * @example Custom game event — no cast needed:
 * ```typescript
 * emit('enemy:died')           // ✅
 * emit('player:damage', 25)    // ✅
 * ```
 */
export function emit<K extends keyof GwenRuntimeHooks>(
  name: K,
  ...args: Parameters<GwenRuntimeHooks[K]>
): void;
export function emit(name: string, ...args: unknown[]): void;
export function emit(name: string, ...args: unknown[]): void {
  const engine = useEngine();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (engine.hooks as any).callHook(name, ...args);
}

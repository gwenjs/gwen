import { onCleanup } from "../cleanup-context.js";
import { useEngine } from "../context.js";
import type { GwenRuntimeHooks } from "../engine/runtime-hooks.js";

/**
 * Subscribes to a {@link GwenRuntimeHooks} event and registers an automatic cleanup.
 *
 * When called inside a lifecycle context — a `defineActor()` factory, a plugin
 * `setup()`, or any function wrapped with {@link withCleanup} — the subscription
 * is automatically removed when the context ends (actor despawn, plugin teardown).
 * Outside any context, `useHook` still works but cleanup must be managed manually
 * via the returned unsubscribe function.
 *
 * Must be called inside an active engine context (i.e., within `defineSystem()`,
 * `defineActor()`, plugin `setup()`, or `engine.run()`).
 *
 * @typeParam K - The event name key from {@link GwenRuntimeHooks}.
 * @param name - The event to subscribe to.
 * @param fn - Handler invoked each time the event fires.
 * @returns An unsubscribe function. Call it to remove the handler early,
 *   before the context ends.
 *
 * @throws {GwenContextError} If called outside any active engine context.
 *
 * @example Auto-cleanup in an actor factory:
 * ```typescript
 * import { defineActor } from '@gwenjs/core/actor'
 * import { useHook } from '@gwenjs/core'
 *
 * const MyActor = defineActor(MyPrefab, () => {
 *   // Automatically removed when the actor is despawned
 *   useHook('entity:spawn', (id) => {
 *     console.log('New entity:', id)
 *   })
 *   return {}
 * })
 * ```
 *
 * @example Auto-cleanup in a system:
 * ```typescript
 * import { defineSystem } from '@gwenjs/core/system'
 * import { useHook } from '@gwenjs/core'
 *
 * export const TrackingSystem = defineSystem(function TrackingSystem() {
 *   // Automatically removed when the engine stops
 *   useHook('entity:spawn', (id) => {
 *     console.log('Entity spawned:', id)
 *   })
 * })
 * ```
 *
 * @example Manual unsubscribe:
 * ```typescript
 * const unsubscribe = useHook('engine:tick', (dt) => {
 *   if (someCondition) {
 *     unsubscribe() // Remove early
 *   }
 * })
 * ```
 *
 * @see {@link onCleanup} — register any cleanup callback in the active context
 * @see {@link GwenRuntimeHooks} — all available event names
 * @since 1.0.0
 */
export function useHook<K extends keyof GwenRuntimeHooks>(
  name: K,
  fn: GwenRuntimeHooks[K],
): () => void {
  const engine = useEngine();
  const unsubscribe = engine.hooks.hook(name, fn as never);
  onCleanup(unsubscribe);
  return unsubscribe;
}

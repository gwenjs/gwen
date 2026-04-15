import { onCleanupIfActive } from "../cleanup-context.js";
import { useEngine } from "../engine/context";
import type { GwenRuntimeHooks } from "../engine/runtime-hooks.js";
import { _tryGetActorInstance } from "../actor/runtime/define-actor.js";

/**
 * A function that removes a previously registered hook subscription.
 *
 * Returned by {@link useHook} and `engine.hooks.hook()`. Call it to unregister
 * the handler before the owning context ends — for example to stop listening
 * to an event mid-lifecycle without waiting for actor despawn.
 *
 * @example
 * ```ts
 * import type { UnsubscribeFn } from '@gwenjs/core'
 *
 * let unsub: UnsubscribeFn | undefined;
 *
 * const Actor = defineActor(MyPrefab, () => {
 *   onStart(() => {
 *     unsub = useHook('entity:create', handleCreate);
 *   });
 *   onDestroy(() => unsub?.());
 * });
 * ```
 */
export type UnsubscribeFn = () => void;

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
 * ### Actor pools and dormancy
 *
 * When called inside a `defineActor()` factory, `useHook` automatically wraps
 * the handler with a dormancy guard. If the actor is returned to a pool via
 * `pool.release()`, the handler is **skipped** when the hook fires and a warning
 * is logged via `engine.logger` (once per actor instance, dev-only). Use
 * {@link onEvent} instead to opt into this behaviour explicitly without the warning.
 *
 * @typeParam K - The event name key from {@link GwenRuntimeHooks}.
 * @param name - The event to subscribe to.
 * @param fn - Handler invoked each time the event fires.
 * @returns An unsubscribe function. Call it to remove the handler early,
 *   before the context ends.
 *
 * @throws {GwenContextError} If called outside any active engine context.
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
 * @see {@link onEvent} — preferred API for event subscriptions inside actors
 * @see {@link onCleanup} — register any cleanup callback in the active context
 * @see {@link GwenRuntimeHooks} — all available event names
 * @since 1.0.0
 */
export function useHook<K extends keyof GwenRuntimeHooks>(
  name: K,
  fn: GwenRuntimeHooks[K],
): UnsubscribeFn {
  const engine = useEngine();
  const instance = _tryGetActorInstance();

  let handler = fn;

  if (instance !== null) {
    // Inside a defineActor() factory: wrap with a dormancy-aware handler.
    //
    // When the actor is dormant (returned to a pool), skip the handler and warn
    // once so the developer knows to use onEvent() instead.
    //
    // Uses `Parameters<typeof fn>` rather than `unknown[]` so TypeScript still
    // verifies argument types at the call site — unlike a plain spread cast that
    // would silently accept any signature mismatch.
    let hasWarned = false;
    handler = ((...args: Parameters<typeof fn>) => {
      if (instance._isDormant && !hasWarned && import.meta.env.DEV) {
        engine.logger.warn(
          `useHook('${name}') fired on a dormant actor. ` +
            `Use onEvent() instead — it skips dormant actors silently.`,
          { hook: name },
        );
        hasWarned = true;
      }
      return (fn as (...a: Parameters<typeof fn>) => unknown)(...args);
    }) as GwenRuntimeHooks[K];
  }

  const unsubscribe: UnsubscribeFn = engine.hooks.hook(name, handler as never);
  // Use the lenient variant: useHook() is valid both inside and outside a cleanup
  // context. When a context is active (actor factory, plugin setup), the handler
  // is auto-removed on despawn/teardown. When there is no context (e.g. engine.run()
  // called directly), cleanup is the caller's responsibility via the returned fn.
  onCleanupIfActive(unsubscribe);
  return unsubscribe;
}

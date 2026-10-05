import { onCleanupIfActive } from "../cleanup-context.js";
import { useEngine } from "../engine/context.js";
import type { GwenRuntimeHooks } from "../engine/runtime-hooks.js";
import { GwenScope } from "../context/scope.js";
import { currentPluginSetupTarget, guardHandler } from "../engine/error-isolation.js";

/**
 * A function that removes a previously registered hook subscription.
 *
 * Returned by {@link useHook}. Call it to unregister the handler before the
 * owning context ends — for example to stop listening to an event mid-lifecycle
 * without waiting for actor despawn.
 *
 * @example
 * ```ts
 * import type { UnsubscribeFn } from '@gwenjs/core'
 *
 * const unsub = useHook('entity:spawn', handleSpawn);
 * // later:
 * unsub();
 * ```
 */
export type UnsubscribeFn = () => void;

/**
 * Subscribes to a {@link GwenRuntimeHooks} event from any engine context
 * (system, actor, plugin, or `engine.run()`).
 *
 * **Automatic cleanup:** when called inside an active {@link GwenScope}
 * (via `scope.run()`, or inside a `defineSystem()` / `defineActor()` /
 * `defineScene()` factory), the subscription is automatically removed when
 * the scope is disposed — no manual cleanup needed. When called outside a
 * scope (e.g. directly in a plugin `setup()` via `onCleanupIfActive`), the
 * returned unsubscribe function must be called manually.
 *
 * **Pool dormancy:** when called inside a `defineActor()` factory for a pooled
 * actor, the handler is automatically silenced while the actor is dormant
 * (returned to the pool). No warning is emitted — dormancy is handled
 * transparently by the scope's {@link ScopedHookable}.
 *
 * **Phase 5 (GwenScope unified):** Always delegates to {@link GwenScope.current}
 * when inside any factory context. Falls back to direct hook registration for
 * plugin setup code outside factory contexts.
 *
 * Must be called inside an active engine context.
 *
 * @typeParam K - The event name key from {@link GwenRuntimeHooks}.
 * @param name - The event to subscribe to.
 * @param fn   - Handler invoked each time the event fires.
 * @returns An unsubscribe function. Call it to remove the handler early.
 *
 * @throws {GwenContextError} If called outside any active engine context.
 *
 * @example
 * ```ts
 * // In a system — auto-removed when the system's scene exits
 * const TrackingSystem = defineSystem(() => {
 *   useHook('entity:spawn', (id) => console.log('spawned', id));
 * });
 *
 * // In an actor — auto-removed on despawn; silent when dormant in a pool
 * const BulletActor = defineActor(BulletPrefab, () => {
 *   useHook('player:fire', handleFire);
 * });
 * ```
 *
 * @see {@link onEnable} / {@link onDisable} — callbacks for pool acquire/release
 * @see {@link GwenRuntimeHooks} — all available event names
 * @since 1.0.0
 */
export function useHook<K extends keyof GwenRuntimeHooks>(
  name: K,
  fn: GwenRuntimeHooks[K],
): UnsubscribeFn {
  const engine = useEngine();

  // Phase 5: GwenScope is the unified context system
  const gwenScope = GwenScope.current();
  if (gwenScope) {
    // Inside a GwenScope (via scope.run()):
    // — dormancy is handled by scope.pause() — no guard needed
    // — cleanup is handled by scope.dispose()
    return gwenScope.hook(name, fn);
  }

  // Synchronous plugin setup: attribute the handler to that plugin.
  // After the first await, or on raw engine.hooks, the handler stays unidentified.
  const setupTarget = currentPluginSetupTarget();
  if (setupTarget) {
    const guarded = guardHandler(
      fn as (...args: unknown[]) => unknown,
      setupTarget,
      String(name),
      engine,
    );
    const unsubscribe = engine.hooks.hook(name, guarded as never);
    onCleanupIfActive(unsubscribe);
    return unsubscribe;
  }

  // Outside any scope (plugin setup via engine.run(), manual use):
  // — register directly on engine.hooks
  // — use onCleanupIfActive so cleanup is automatic if a cleanup context is active
  // boundary: hookable's hook() rejects a typed handler that is not a subtype of its internal slot.
  const unsubscribe = engine.hooks.hook(name, fn as never);
  onCleanupIfActive(unsubscribe);
  return unsubscribe;
}

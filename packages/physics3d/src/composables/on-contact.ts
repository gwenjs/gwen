/**
 * @file onContact() — register a callback for 3D contact events this frame.
 *
 * Callbacks live on the current engine. Engine A never receives engine B's contacts.
 */
import { useEngine } from "@gwenjs/core";
import type { GwenEngine } from "@gwenjs/core";
import { createContactRegistry, onContact as coreOnContact } from "@gwenjs/physics-core";
import type { CollisionContact } from "../types";

/**
 * Register a callback to be invoked for every 3D contact event dispatched this frame.
 *
 * Must be called inside an active engine context (inside `defineSystem()`,
 * `engine.run()`, or a plugin lifecycle hook).
 *
 * A {@link CollisionContact} includes the two participating entity IDs,
 * optional per-side collider IDs, and a flag indicating whether contact started
 * or ended this frame.
 *
 * @param callback - Function invoked with each {@link CollisionContact}.
 * @returns An unregister function. Call it to remove the callback (e.g. on actor
 *   despawn) and prevent stale-closure memory leaks.
 *
 * @example
 * ```typescript
 * onContact((contact) => {
 *   if (contact.started) {
 *     console.log('contact between', contact.entityA, 'and', contact.entityB)
 *   }
 * })
 * ```
 *
 * @since 1.0.0
 */
export function onContact(callback: (contact: CollisionContact) => void): () => void {
  return coreOnContact(callback);
}

/**
 * Dispatch a contact event to all registered callbacks.
 *
 * Called by the Physics3D plugin during the `onUpdate` phase after processing
 * the collision event list. Not intended for direct use in game code.
 *
 * @param event - The contact event to dispatch.
 * @internal
 */
export function _dispatchContactEvent(event: CollisionContact): void {
  createContactRegistry().peek(useEngine("Physics3DPlugin"))?.emit(event);
}

/**
 * Remove all registered contact callbacks.
 *
 * Used in tests and plugin teardown to reset the callback registry.
 *
 * @internal
 */
export function _clearContactCallbacks(): void {
  const registry = createContactRegistry().peek(useEngine("Physics3DPlugin"));
  if (registry === undefined) return;
  registry.entries.length = 0;
}

/** Drop every contact callback owned by `engine`. */
export function clearEngineContacts(engine: GwenEngine): void {
  const registry = createContactRegistry().peek(engine);
  if (registry === undefined) return;
  registry.entries.length = 0;
}

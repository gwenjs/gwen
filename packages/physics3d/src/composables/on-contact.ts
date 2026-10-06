/**
 * @file onContact() — register a callback for 3D contact events this frame.
 *
 * Callbacks live on the current engine. Engine A never receives engine B's contacts.
 */
import { createEngineLocal, GwenContextError } from "@gwenjs/core";
import type { GwenEngine } from "@gwenjs/core";
import type { Physics3DCollisionContact } from "../types";

type ContactCallback = (e: Physics3DCollisionContact) => void;

const contacts = createEngineLocal<ContactCallback[]>(() => []);

function listOrNull(): ContactCallback[] | undefined {
  try {
    return contacts.use();
  } catch (error) {
    if (error instanceof GwenContextError) return undefined;
    throw error;
  }
}

/**
 * Register a callback to be invoked for every 3D contact event dispatched this frame.
 *
 * Must be called inside an active engine context (inside `defineSystem()`,
 * `engine.run()`, or a plugin lifecycle hook).
 *
 * A {@link Physics3DCollisionContact} includes the two participating entity IDs,
 * optional per-side collider IDs, and a flag indicating whether contact started
 * or ended this frame.
 *
 * @param callback - Function invoked with each {@link Physics3DCollisionContact}.
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
export function onContact(callback: (contact: Physics3DCollisionContact) => void): () => void {
  const list = contacts.use();
  list.push(callback);
  return () => {
    const idx = list.indexOf(callback);
    if (idx !== -1) list.splice(idx, 1);
  };
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
export function _dispatchContactEvent(event: Physics3DCollisionContact): void {
  const list = listOrNull();
  if (!list) return;
  for (const cb of list) cb(event);
}

/**
 * Remove all registered contact callbacks.
 *
 * Used in tests and plugin teardown to reset the callback registry.
 *
 * @internal
 */
export function _clearContactCallbacks(): void {
  const list = listOrNull();
  if (!list) return;
  list.length = 0;
}

/** Drop every contact callback owned by `engine`. */
export function clearEngineContacts(engine: GwenEngine): void {
  const list = contacts.peek(engine);
  if (!list) return;
  list.length = 0;
}

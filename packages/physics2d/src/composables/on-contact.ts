/**
 * @file onContact() — subscribes to collision events for the current actor entity.
 */
import type { ContactEvent } from '../types';

/** @internal Entity-keyed registry of onContact callbacks (entity string key → callbacks). */
const _contactCallbacks = new Map<string, ((e: ContactEvent) => void)[]>();

/**
 * @internal Called by the physics2d plugin per-frame to dispatch contact events.
 *
 * @param entityId - The entity involved in the contact.
 * @param event - The contact event data.
 */
export function _dispatchContactEvent(entityId: bigint, event: ContactEvent): void {
  const cbs = _contactCallbacks.get(String(entityId));
  if (cbs) {
    for (const cb of cbs) cb(event);
  }
}

/**
 * Subscribes to collision contact events for the current actor entity.
 *
 * Events are dispatched once per frame after the physics step.
 * In production use this is called inside a `defineActor()` factory where the actor entity
 * ID is captured via `_currentSetupEntityId`. Pass `entityId` explicitly in tests.
 *
 * @param callback - Called for each contact event involving this entity.
 * @param entityId - Optional explicit entity ID (used in tests; resolved from actor context in production).
 * @returns {void}
 *
 * @example
 * ```typescript
 * const KartActor = defineActor(KartPrefab, () => {
 *   onContact((e) => {
 *     if (e.relativeVelocity > 200) emit('kart:crash', { velocity: e.relativeVelocity })
 *   })
 * })
 * ```
 *
 * @since 1.0.0
 */
export function onContact(callback: (contact: ContactEvent) => void, entityId?: bigint): void {
  const id = entityId ?? _currentSetupEntityId;
  if (id === null) return;
  const key = String(id);
  if (!_contactCallbacks.has(key)) _contactCallbacks.set(key, []);
  _contactCallbacks.get(key)!.push(callback);
}

/**
 * Remove all contact callbacks registered for the given entity.
 * Should be called when an actor is despawned to prevent memory leaks.
 *
 * @param entityId - The entity whose callbacks should be cleared.
 * @internal
 */
export function _clearContactCallbacks(entityId: bigint): void {
  _contactCallbacks.delete(String(entityId));
}

/** @internal Module-level actor entity ID set during actor factory execution. */
let _currentSetupEntityId: bigint | null = null;

/**
 * @internal Set by the actor spawn context to bind `onContact()` to the current entity.
 *
 * @param id - Entity ID to bind, or `null` to clear.
 */
export function _setCurrentContactEntityId(id: bigint | null): void {
  _currentSetupEntityId = id;
}

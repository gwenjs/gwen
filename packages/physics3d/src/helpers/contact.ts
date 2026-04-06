/**
 * Contact helper utilities for the Physics3D plugin.
 *
 * All helpers are pure functions that operate on the data types exported by
 * the plugin — no WASM dependency.
 */

import type { EntityId } from '@gwenjs/core';
import type { Physics3DCollisionContact } from '../types';

/**
 * Filter a contact batch to those involving a specific entity.
 *
 * The entity may appear on either side of the contact pair.
 *
 * @param batch    - Contacts from `physics3d.getCollisionContacts()`.
 * @param entityId - Packed `EntityId` to filter on.
 * @returns All contacts where `entityId` is `entityA` or `entityB`.
 *
 * @example
 * ```ts
 * const myContacts = selectContactsForEntityId(physics3d.getCollisionContacts(), playerId);
 * ```
 */
export function selectContactsForEntityId(
  batch: ReadonlyArray<Physics3DCollisionContact>,
  entityId: EntityId,
): Physics3DCollisionContact[] {
  return batch.filter((c) => c.entityA === entityId || c.entityB === entityId);
}

/**
 * Deduplicate contacts by ordered pair identity within a single frame.
 *
 * Pair identity is **order-independent**: `(A, B, started)` deduplicates
 * `(B, A, started)`. The **first** occurrence is kept.
 *
 * When collider ids are present they are included in the pair key, so
 * multi-collider contacts between the same entity pair are preserved.
 * Contacts without collider ids share a sentinel key per `started` state —
 * only the first such event per state is kept.
 *
 * @param contacts - Input contacts, typically from `getCollisionContacts()`.
 * @returns A new deduplicated array preserving source order of first occurrences.
 *
 * @example
 * ```ts
 * const unique = dedupeContactsByPair(physics3d.getCollisionContacts());
 * ```
 */
export function dedupeContactsByPair(
  contacts: ReadonlyArray<Physics3DCollisionContact>,
): Physics3DCollisionContact[] {
  const out: Physics3DCollisionContact[] = [];
  const seen = new Set<string>();

  for (const c of contacts) {
    const idA = c.aColliderId ?? -1;
    const idB = c.bColliderId ?? -1;
    const pairMin = idA < idB ? idA : idB;
    const pairMax = idA < idB ? idB : idA;
    // Include entity ids to distinguish same-collider contacts across different entities
    const eA = String(c.entityA);
    const eB = String(c.entityB);
    const pairEntityMin = eA < eB ? eA : eB;
    const pairEntityMax = eA < eB ? eB : eA;
    const key = `${pairEntityMin}:${pairEntityMax}:${pairMin}:${pairMax}:${c.started ? 1 : 0}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }

  return out;
}

/**
 * Filter already-resolved contacts for one specific packed `EntityId`.
 *
 * Use this when you already hold a contact array (e.g. from the hook) and
 * want an EntityId-first view without calling the full service API again.
 *
 * @param contacts - Pre-resolved contact array.
 * @param entityId - Packed `EntityId` to filter on.
 * @returns All contacts where `entityId` participates.
 */
export function selectResolvedContactsForEntityId(
  contacts: ReadonlyArray<Physics3DCollisionContact>,
  entityId: EntityId,
): Physics3DCollisionContact[] {
  return contacts.filter((c) => c.entityA === entityId || c.entityB === entityId);
}

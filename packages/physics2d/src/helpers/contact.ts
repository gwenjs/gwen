import { createEntityId, unpackEntityId } from '@gwenjs/core';
import type { EntityId } from '@gwenjs/core';
import type {
  CollisionEvent,
  CollisionEventsBatch,
  Physics2DAPI,
  ResolvedCollisionContact,
} from '../types';

/** Minimal interface needed to resolve entity generation numbers. */
interface GenerationSource {
  getEntityGeneration(slot: number): number | undefined;
}

/**
 * Internal structural type used by slot-dependent helpers.
 * Satisfied by `InternalCollisionEvent` in the plugin core.
 * Not exported — internal use only.
 */
type SlottedEvent = {
  slotA: number;
  slotB: number;
  started: boolean;
  aColliderId?: number;
  bColliderId?: number;
};

/**
 * EntityId-first contact filter helper.
 *
 * Extracts the raw slot index from a packed `EntityId` and filters the batch
 * to events where the entity participates on either side.
 *
 * @param batch - Collision event batch from `physics.getCollisionEventsBatch()`.
 * @param entityId - Packed `EntityId` to filter on.
 * @returns All events where the entity's slot matches `slotA` or `slotB`.
 */
export function selectContactsForEntityId(
  batch: CollisionEventsBatch,
  entityId: EntityId,
): CollisionEvent[] {
  const { index } = unpackEntityId(entityId);
  return (batch.events as unknown as SlottedEvent[]).filter(
    (e) => e.slotA === index || e.slotB === index,
  ) as unknown as CollisionEvent[];
}

/**
 * Remove duplicate events for the same contact pair and state within a frame.
 *
 * Pair identity is **order-independent**: `(A, B, started)` deduplicates `(B, A, started)`.
 * The **first** occurrence is kept; subsequent duplicates are dropped.
 * Output order is deterministic and matches input order of surviving events.
 *
 * Pair identity is keyed on `aColliderId` / `bColliderId` when present.
 * Events without collider ids fall back to a shared sentinel key — only the first
 * such event per `started` state is retained.
 *
 * Use this when `coalesceEvents` is disabled at the plugin level, or when
 * consuming events from multiple sources.
 *
 * @param events - Raw collision events, typically from a batch or filtered set.
 * @returns A new deduplicated array, preserving source order of first occurrences.
 *
 * @example
 * ```ts
 * const unique = dedupeContactsByPair(batch.events);
 * ```
 */
export function dedupeContactsByPair(events: ReadonlyArray<CollisionEvent>): CollisionEvent[] {
  const out: CollisionEvent[] = [];
  const seen = new Set<string>();

  for (const ev of events) {
    const idA = ev.aColliderId ?? -1;
    const idB = ev.bColliderId ?? -1;
    const min = Math.min(idA, idB);
    const max = Math.max(idA, idB);
    const key = `${min}:${max}:${ev.started ? 1 : 0}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ev);
  }

  return out;
}

/**
 * Resolve slot-based collision events into packed `EntityId` contacts.
 *
 * Accepts any object that carries `slotA`, `slotB`, `started`, and optional
 * collider ids — in practice this is the plugin's internal `InternalCollisionEvent`.
 *
 * Events for slots whose generation cannot be resolved (destroyed or unregistered
 * entities) are **silently skipped**.
 *
 * @param api - Engine API providing `getEntityGeneration(slot)`.
 * @param events - Slot-bearing collision events (internal representation).
 * @returns Resolved contacts with packed `EntityId`s, in source order.
 *
 * @example
 * ```ts
 * const contacts = toResolvedContacts(api, batch.events);
 * for (const { entityA, entityB, started } of contacts) {
 *   if (!started) continue;
 *   const tag = api.getComponent(entityA, Tag);
 * }
 * ```
 */
export function toResolvedContacts(
  source: GenerationSource,
  events: ReadonlyArray<SlottedEvent>,
): ResolvedCollisionContact[] {
  const out: ResolvedCollisionContact[] = [];

  for (const ev of events) {
    const genA = source.getEntityGeneration(ev.slotA);
    const genB = source.getEntityGeneration(ev.slotB);
    if (genA === undefined || genB === undefined) continue;

    out.push({
      entityA: createEntityId(ev.slotA, genA),
      entityB: createEntityId(ev.slotB, genB),
      started: ev.started,
      ...(ev.aColliderId !== undefined ? { aColliderId: ev.aColliderId } : {}),
      ...(ev.bColliderId !== undefined ? { bColliderId: ev.bColliderId } : {}),
    });
  }

  return out;
}

/**
 * Filter already-resolved contacts for one packed `EntityId`.
 *
 * Useful in gameplay systems that consume `physics.getCollisionContacts()` and
 * want an EntityId-first path without slot checks.
 */
export function selectResolvedContactsForEntityId(
  contacts: ReadonlyArray<ResolvedCollisionContact>,
  entityId: EntityId,
): ResolvedCollisionContact[] {
  return contacts.filter((c) => c.entityA === entityId || c.entityB === entityId);
}

/**
 * Pull and filter resolved contacts for one entity in a single call.
 *
 * EntityId-first convenience helper for gameplay systems.
 */
export function getEntityCollisionContacts(
  physics: Physics2DAPI,
  entityId: EntityId,
  opts?: { max?: number },
): ResolvedCollisionContact[] {
  return selectResolvedContactsForEntityId(physics.getCollisionContacts(opts), entityId);
}

import { createEntityId } from '@gwenjs/core';
import { describe, expect, it } from 'vitest';
import type { CollisionEventsBatch } from '../src/types';
import {
  dedupeContactsByPair,
  getEntityCollisionContacts,
  selectContactsForEntityId,
  selectResolvedContactsForEntityId,
  toResolvedContacts,
} from '../src/helpers/contact';

/**
 * Build a minimal CollisionEventsBatch for tests.
 * Events are cast to the expected type because tests need slot fields
 * at runtime (internally accessed via SlottedEvent cast).
 */
function makeBatch(events: object[]): CollisionEventsBatch {
  return {
    frame: 1,
    count: events.length,
    droppedSinceLastRead: 0,
    droppedCritical: 0,
    droppedNonCritical: 0,
    coalesced: true,
    events: events as CollisionEventsBatch['events'],
  };
}

describe('contact helpers', () => {
  it('should select events for one EntityId', () => {
    const selected = selectContactsForEntityId(
      makeBatch([
        { slotA: 12, slotB: 2, started: true },
        { slotA: 7, slotB: 12, started: false },
        { slotA: 3, slotB: 4, started: true },
      ]),
      createEntityId(12, 3),
    );

    expect(selected).toHaveLength(2);
  });

  it('should return empty array when no events match the EntityId', () => {
    const selected = selectContactsForEntityId(
      makeBatch([{ slotA: 5, slotB: 6, started: true }]),
      createEntityId(99, 0),
    );

    expect(selected).toHaveLength(0);
  });

  it('should return empty array when batch has no events', () => {
    const selected = selectContactsForEntityId(makeBatch([]), createEntityId(1, 0));
    expect(selected).toHaveLength(0);
  });

  it('should select resolved contacts for one EntityId', () => {
    const e1 = createEntityId(1, 0);
    const e2 = createEntityId(2, 0);
    const e3 = createEntityId(3, 0);

    const selected = selectResolvedContactsForEntityId(
      [
        { entityA: e1, entityB: e2, started: true },
        { entityA: e3, entityB: e1, started: false },
      ],
      e1,
    );

    expect(selected).toHaveLength(2);
  });

  it('should pull and filter resolved contacts for one EntityId', () => {
    const e1 = createEntityId(1, 0);
    const e2 = createEntityId(2, 0);
    const e3 = createEntityId(3, 0);

    const physics = {
      getCollisionContacts: () => [
        { entityA: e1, entityB: e2, started: true },
        { entityA: e3, entityB: e2, started: false },
      ],
    } as any;

    const selected = getEntityCollisionContacts(physics, e2);
    expect(selected).toHaveLength(2);
  });

  it('should dedupe symmetric pairs deterministically by collider id', () => {
    const deduped = dedupeContactsByPair([
      { aColliderId: 1, bColliderId: 2, started: true },
      { aColliderId: 2, bColliderId: 1, started: true },
      { aColliderId: 1, bColliderId: 2, started: false },
    ]);

    expect(deduped).toEqual([
      { aColliderId: 1, bColliderId: 2, started: true },
      { aColliderId: 1, bColliderId: 2, started: false },
    ]);
  });

  it('should return empty array when input is empty', () => {
    expect(dedupeContactsByPair([])).toEqual([]);
  });

  it('should keep ended events separate from started events for same pair', () => {
    const deduped = dedupeContactsByPair([
      { aColliderId: 1, bColliderId: 2, started: true },
      { aColliderId: 1, bColliderId: 2, started: false },
    ]);

    expect(deduped).toHaveLength(2);
  });

  it('should resolve slots into packed entity ids', () => {
    const api = {
      getEntityGeneration(slot: number) {
        return slot === 1 || slot === 2 ? 3 : undefined;
      },
    } as any;

    const resolved = toResolvedContacts(api, [{ slotA: 1, slotB: 2, started: true }]);

    expect(resolved).toEqual([
      {
        entityA: createEntityId(1, 3),
        entityB: createEntityId(2, 3),
        started: true,
        aColliderId: undefined,
        bColliderId: undefined,
      },
    ]);
  });

  it('should preserve colliderId fields when present', () => {
    const api = {
      getEntityGeneration: () => 1,
    } as any;

    const resolved = toResolvedContacts(api, [
      { slotA: 0, slotB: 1, started: true, aColliderId: 10, bColliderId: 20 },
    ]);

    expect(resolved[0].aColliderId).toBe(10);
    expect(resolved[0].bColliderId).toBe(20);
  });

  it('should skip unresolved entity A', () => {
    const api = {
      getEntityGeneration(slot: number) {
        return slot === 2 ? 1 : undefined;
      },
    } as any;

    const resolved = toResolvedContacts(api, [{ slotA: 1, slotB: 2, started: true }]);
    expect(resolved).toHaveLength(0);
  });

  it('should skip unresolved entity B', () => {
    const api = {
      getEntityGeneration(slot: number) {
        return slot === 1 ? 1 : undefined;
      },
    } as any;

    const resolved = toResolvedContacts(api, [{ slotA: 1, slotB: 2, started: true }]);
    expect(resolved).toHaveLength(0);
  });

  it('should return empty array when input events list is empty', () => {
    const api = { getEntityGeneration: () => 1 } as any;
    expect(toResolvedContacts(api, [])).toEqual([]);
  });
});

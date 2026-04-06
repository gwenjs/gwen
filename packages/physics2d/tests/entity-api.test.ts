/**
 * PR-08: Entity-native physics API enforcement.
 *
 * Verifies that the public Physics2D API surface operates exclusively on
 * EntityId semantics — no slot-index argument required by any public method.
 */

import { describe, it, expect } from 'vitest';
import type {
  Physics2DAPI,
  CollisionContact,
  ResolvedCollisionContact,
  PhysicsEntitySnapshot,
} from '../src/types';
import type { EntityId } from '@gwenjs/core';

// ── API method signatures use EntityId, not number slots ─────────────────────

describe('Physics2DAPI — EntityId-native surface', () => {
  it('addBody accepts EntityId (bigint)', () => {
    // Compile-time check: EntityId is a branded bigint.
    // This test ensures the public API type accepts EntityId without casting.
    const id = BigInt(1) as EntityId;
    type AddBodyFn = Physics2DAPI['addBody'];
    // The first parameter must be assignable from EntityId
    type FirstParam = Parameters<AddBodyFn>[0];
    const _check: FirstParam = id;
    expect(typeof _check).toBe('bigint');
  });

  it('removeBody accepts EntityId', () => {
    const id = BigInt(1) as EntityId;
    type RemoveBodyFn = Physics2DAPI['removeBody'];
    type FirstParam = Parameters<RemoveBodyFn>[0];
    const _check: FirstParam = id;
    expect(typeof _check).toBe('bigint');
  });

  it('setBodyVelocity accepts EntityId', () => {
    const id = BigInt(1) as EntityId;
    type Fn = Physics2DAPI['setBodyVelocity'];
    type FirstParam = Parameters<Fn>[0];
    const _check: FirstParam = id;
    expect(typeof _check).toBe('bigint');
  });

  it('getBodyState accepts EntityId', () => {
    const id = BigInt(1) as EntityId;
    type Fn = Physics2DAPI['getBodyState'];
    type FirstParam = Parameters<Fn>[0];
    const _check: FirstParam = id;
    expect(typeof _check).toBe('bigint');
  });
});

// ── CollisionContact already provides EntityId fields ─────────────────────────

describe('CollisionContact — EntityId fields present', () => {
  it('has entityA and entityB as EntityId', () => {
    // Construct a mock contact using only EntityId semantics
    const mockContact: CollisionContact = {
      entityA: BigInt(1) as EntityId,
      entityB: BigInt(2) as EntityId,
      started: true,
    };

    expect(typeof mockContact.entityA).toBe('bigint');
    expect(typeof mockContact.entityB).toBe('bigint');
    expect(mockContact.started).toBe(true);
  });

  it('consumer code should only need entityA/entityB', () => {
    // Simulate a handler that only uses EntityId fields
    const handler = (contacts: ReadonlyArray<CollisionContact>) => {
      return contacts.map(({ entityA, entityB, started }) => ({
        a: entityA,
        b: entityB,
        started,
      }));
    };

    const result = handler([
      {
        entityA: BigInt(10) as EntityId,
        entityB: BigInt(20) as EntityId,
        started: true,
      },
    ]);

    expect(result[0].a).toBe(BigInt(10));
    expect(result[0].b).toBe(BigInt(20));
  });
});

// ── ResolvedCollisionContact — EntityId fields present ────────────────────────

describe('ResolvedCollisionContact — EntityId fields present', () => {
  it('entityA and entityB are present and typed as EntityId', () => {
    const contact: ResolvedCollisionContact = {
      entityA: BigInt(5) as EntityId,
      entityB: BigInt(6) as EntityId,
      started: false,
    };

    expect(typeof contact.entityA).toBe('bigint');
    expect(typeof contact.entityB).toBe('bigint');
  });
});

// ── PhysicsEntitySnapshot — EntityId is the primary key ──────────────────────

describe('PhysicsEntitySnapshot — entityId is primary key', () => {
  it('entityId is the primary key', () => {
    const snapshot: PhysicsEntitySnapshot = {
      entityId: BigInt(99) as EntityId,
      position: { x: 1, y: 2, rotation: 0 },
      velocity: { x: 0, y: 0 },
    };

    expect(typeof snapshot.entityId).toBe('bigint');
    expect(snapshot.entityId).toBe(BigInt(99));
  });
});

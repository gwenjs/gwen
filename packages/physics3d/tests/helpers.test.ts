/**
 * Tests for Physics3D helper utilities.
 * All helpers are pure functions tested independently of the plugin.
 */
import { describe, it, expect, vi } from 'vitest';

import {
  selectContactsForEntityId,
  dedupeContactsByPair,
  selectResolvedContactsForEntityId,
} from '../src/helpers/contact';

import { moveKinematicByVelocity, applyDirectionalImpulse } from '../src/helpers/movement';

import { getBodySnapshot, getSpeed, isSensorActive } from '../src/helpers/queries';

import type { EntityId } from '@gwenjs/core';
import type { Physics3DCollisionContact, Physics3DAPI, Physics3DBodySnapshot } from '../src/types';

// ─── Typed EntityId stubs ──────────────────────────────────────────��─────────

const e1 = 1n as unknown as EntityId;
const e2 = 2n as unknown as EntityId;
const e3 = 3n as unknown as EntityId;

// ─── contact helpers ─────────────────────────────────────────────────────────

describe('selectContactsForEntityId', () => {
  const contacts: Physics3DCollisionContact[] = [
    { entityA: e1, entityB: e2, started: true },
    { entityA: e2, entityB: e3, started: false },
    { entityA: e3, entityB: e1, started: true },
  ];

  it('returns contacts where entity is entityA', () => {
    const result = selectContactsForEntityId(contacts, e1);
    expect(result).toHaveLength(2);
    expect(result.every((c) => c.entityA === e1 || c.entityB === e1)).toBe(true);
  });

  it('returns contacts where entity is entityB', () => {
    const result = selectContactsForEntityId(contacts, e2);
    expect(result).toHaveLength(2);
  });

  it('returns empty array when entity is not involved', () => {
    const result = selectContactsForEntityId(contacts, 99n as EntityId);
    expect(result).toHaveLength(0);
  });

  it('returns empty array on empty input', () => {
    expect(selectContactsForEntityId([], e1)).toHaveLength(0);
  });
});

describe('dedupeContactsByPair', () => {
  it('removes exact duplicate contacts (same entities, same colliders, same state)', () => {
    const contacts: Physics3DCollisionContact[] = [
      { entityA: e1, entityB: e2, aColliderId: 0, bColliderId: 1, started: true },
      { entityA: e1, entityB: e2, aColliderId: 0, bColliderId: 1, started: true },
    ];
    expect(dedupeContactsByPair(contacts)).toHaveLength(1);
  });

  it('treats (A, B) and (B, A) as the same pair', () => {
    const contacts: Physics3DCollisionContact[] = [
      { entityA: e1, entityB: e2, aColliderId: 0, bColliderId: 1, started: true },
      { entityA: e2, entityB: e1, aColliderId: 1, bColliderId: 0, started: true },
    ];
    expect(dedupeContactsByPair(contacts)).toHaveLength(1);
  });

  it('keeps start and end events as distinct', () => {
    const contacts: Physics3DCollisionContact[] = [
      { entityA: e1, entityB: e2, aColliderId: 0, bColliderId: 0, started: true },
      { entityA: e1, entityB: e2, aColliderId: 0, bColliderId: 0, started: false },
    ];
    expect(dedupeContactsByPair(contacts)).toHaveLength(2);
  });

  it('preserves events without collider ids (one per started state)', () => {
    const contacts: Physics3DCollisionContact[] = [
      { entityA: e1, entityB: e2, started: true },
      { entityA: e1, entityB: e2, started: true },
    ];
    expect(dedupeContactsByPair(contacts)).toHaveLength(1);
  });

  it('preserves different entity pairs', () => {
    const contacts: Physics3DCollisionContact[] = [
      { entityA: e1, entityB: e2, aColliderId: 0, bColliderId: 0, started: true },
      { entityA: e1, entityB: e3, aColliderId: 0, bColliderId: 0, started: true },
    ];
    expect(dedupeContactsByPair(contacts)).toHaveLength(2);
  });

  it('returns empty array for empty input', () => {
    expect(dedupeContactsByPair([])).toHaveLength(0);
  });
});

describe('selectResolvedContactsForEntityId', () => {
  const contacts: Physics3DCollisionContact[] = [
    { entityA: e1, entityB: e2, started: true },
    { entityA: e2, entityB: e3, started: true },
    { entityA: e3, entityB: e1, started: false },
  ];

  it('filters contacts involving the entity', () => {
    const result = selectResolvedContactsForEntityId(contacts, e1);
    expect(result).toHaveLength(2);
    expect(result.every((c) => c.entityA === e1 || c.entityB === e1)).toBe(true);
  });

  it('returns empty when no match', () => {
    expect(selectResolvedContactsForEntityId(contacts, 999n as EntityId)).toHaveLength(0);
  });
});

// ─── movement helpers ─────────────────────────────────────────────────────────

describe('moveKinematicByVelocity', () => {
  function makePhysics(_returns = { x: 0, y: 0, z: 0 }): Physics3DAPI {
    return {
      setKinematicPosition: vi.fn(() => true),
      getBodyState: vi.fn(),
    } as unknown as Physics3DAPI;
  }

  it('calls setKinematicPosition with integrated position', () => {
    const physics = makePhysics();
    const pos = { x: 0, y: 0, z: 0 };
    const rot = { x: 0, y: 0, z: 0, w: 1 };
    const vel = { x: 10, y: 0, z: 5 };
    moveKinematicByVelocity(physics, e1, pos, rot, vel, 0.5);
    expect(physics.setKinematicPosition).toHaveBeenCalledWith(e1, { x: 5, y: 0, z: 2.5 }, rot);
  });

  it('is a no-op when dt <= 0', () => {
    const physics = makePhysics();
    moveKinematicByVelocity(
      physics,
      e1,
      { x: 1, y: 2, z: 3 },
      { x: 0, y: 0, z: 0, w: 1 },
      { x: 5, y: 5, z: 5 },
      0,
    );
    expect(physics.setKinematicPosition).not.toHaveBeenCalled();
  });

  it('is a no-op when dt is non-finite', () => {
    const physics = makePhysics();
    moveKinematicByVelocity(
      physics,
      e1,
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 0, w: 1 },
      { x: 1, y: 1, z: 1 },
      Infinity,
    );
    expect(physics.setKinematicPosition).not.toHaveBeenCalled();
  });
});

describe('applyDirectionalImpulse', () => {
  function makePhysics(): Physics3DAPI {
    return { applyImpulse: vi.fn(() => true) } as unknown as Physics3DAPI;
  }

  it('normalizes the direction and scales by magnitude', () => {
    const physics = makePhysics();
    applyDirectionalImpulse(physics, e1, { x: 0, y: 2, z: 0 }, 10);
    expect(physics.applyImpulse).toHaveBeenCalledWith(e1, { x: 0, y: 10, z: 0 });
  });

  it('handles diagonal directions correctly', () => {
    const physics = makePhysics();
    applyDirectionalImpulse(physics, e1, { x: 1, y: 0, z: 1 }, Math.sqrt(2));
    expect((physics.applyImpulse as ReturnType<typeof vi.fn>).mock.calls[0][1].x).toBeCloseTo(1, 5);
    expect((physics.applyImpulse as ReturnType<typeof vi.fn>).mock.calls[0][1].z).toBeCloseTo(1, 5);
  });

  it('is a no-op for zero direction vector', () => {
    const physics = makePhysics();
    applyDirectionalImpulse(physics, e1, { x: 0, y: 0, z: 0 }, 10);
    expect(physics.applyImpulse).not.toHaveBeenCalled();
  });

  it('is a no-op for zero magnitude', () => {
    const physics = makePhysics();
    applyDirectionalImpulse(physics, e1, { x: 1, y: 0, z: 0 }, 0);
    expect(physics.applyImpulse).not.toHaveBeenCalled();
  });

  it('is a no-op for non-finite magnitude', () => {
    const physics = makePhysics();
    applyDirectionalImpulse(physics, e1, { x: 1, y: 0, z: 0 }, NaN);
    expect(physics.applyImpulse).not.toHaveBeenCalled();
  });
});

// ─── query helpers ────────────────────────────────────────────────────────────

describe('getBodySnapshot', () => {
  it('delegates to physics.getBodySnapshot', () => {
    const snapshot: Physics3DBodySnapshot = {
      entityId: e1,
      position: { x: 1, y: 2, z: 3 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      linearVelocity: { x: 4, y: 5, z: 6 },
      angularVelocity: { x: 0, y: 0, z: 0 },
    };
    const physics = { getBodySnapshot: vi.fn(() => snapshot) } as unknown as Physics3DAPI;
    expect(getBodySnapshot(physics, e1)).toBe(snapshot);
    expect(physics.getBodySnapshot).toHaveBeenCalledWith(e1);
  });

  it('returns undefined when body is absent', () => {
    const physics = { getBodySnapshot: vi.fn(() => undefined) } as unknown as Physics3DAPI;
    expect(getBodySnapshot(physics, e1)).toBeUndefined();
  });
});

describe('getSpeed', () => {
  it('returns 0 when no velocity is available', () => {
    const physics = { getLinearVelocity: vi.fn(() => undefined) } as unknown as Physics3DAPI;
    expect(getSpeed(physics, e1)).toBe(0);
  });

  it('computes 3D speed correctly', () => {
    const physics = {
      getLinearVelocity: vi.fn(() => ({ x: 3, y: 4, z: 0 })),
    } as unknown as Physics3DAPI;
    expect(getSpeed(physics, e1)).toBeCloseTo(5, 5);
  });

  it('computes 3D diagonal speed correctly', () => {
    const physics = {
      getLinearVelocity: vi.fn(() => ({ x: 1, y: 1, z: 1 })),
    } as unknown as Physics3DAPI;
    expect(getSpeed(physics, e1)).toBeCloseTo(Math.sqrt(3), 5);
  });
});

describe('isSensorActive', () => {
  it('returns true when sensor is active', () => {
    const physics = {
      getSensorState: vi.fn(() => ({ contactCount: 1, isActive: true })),
    } as unknown as Physics3DAPI;
    expect(isSensorActive(physics, e1, 0xf007)).toBe(true);
  });

  it('returns false when sensor is inactive', () => {
    const physics = {
      getSensorState: vi.fn(() => ({ contactCount: 0, isActive: false })),
    } as unknown as Physics3DAPI;
    expect(isSensorActive(physics, e1, 0xf007)).toBe(false);
  });

  it('forwards the sensorId to getSensorState', () => {
    const physics = {
      getSensorState: vi.fn(() => ({ contactCount: 0, isActive: false })),
    } as unknown as Physics3DAPI;
    isSensorActive(physics, e1, 42);
    expect(physics.getSensorState).toHaveBeenCalledWith(e1, 42);
  });
});

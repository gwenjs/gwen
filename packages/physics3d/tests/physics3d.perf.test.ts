import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContactRingBuffer3D } from '../src/plugin/ring-buffer.js';

// ─── Mocks for dynamic body perf test ─────────────────────────────────────

vi.mock('@gwenjs/core/scene', () => ({
  _getActorEntityId: vi.fn(() => 1n),
}));

const mockBodyHandle = {
  bodyId: 1,
  entityId: 0,
  kind: 'dynamic',
  mass: 1,
  linearDamping: 0,
  angularDamping: 0,
};

const mockPhysics3D = {
  createBody: vi.fn(() => mockBodyHandle),
  removeBody: vi.fn(() => true),
  applyImpulse: vi.fn(() => true),
  applyAngularImpulse: vi.fn(() => true),
  applyTorque: vi.fn(() => true),
  setLinearVelocity: vi.fn(() => true),
  getLinearVelocity: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
  getAngularVelocity: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
  addCollider: vi.fn(() => true),
  removeCollider: vi.fn(() => true),
};

vi.mock('../src/composables.js', () => ({
  usePhysics3D: vi.fn(() => mockPhysics3D),
}));

import { useDynamicBody } from '../src/composables/use-dynamic-body.js';
import {
  onContact,
  _dispatchContactEvent,
  _clearContactCallbacks,
} from '../src/composables/on-contact.js';
import type { Physics3DCollisionContact } from '../src/types.js';

describe('physics3d performance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPhysics3D.createBody.mockReturnValue(mockBodyHandle);
  });

  it('drains 500 contact events in < 0.5ms', () => {
    const buf = new ContactRingBuffer3D();

    for (let i = 0; i < 500; i++) {
      buf.write({
        entityAIdx: i,
        entityBIdx: i + 1,
        contactX: 0,
        contactY: 0,
        contactZ: 0,
        normalX: 0,
        normalY: 1,
        normalZ: 0,
        relativeVelocity: 1,
        restitution: 0,
      });
    }

    const start = performance.now();
    const events = buf.drain();
    const elapsed = performance.now() - start;

    expect(events).toHaveLength(500);
    expect(elapsed).toBeLessThan(0.5);
  });

  it('writing and draining 512 events (full ring capacity) completes without data loss', () => {
    const buf = new ContactRingBuffer3D();

    for (let i = 0; i < 512; i++) {
      buf.write({
        entityAIdx: i,
        entityBIdx: i + 1,
        contactX: i,
        contactY: 0,
        contactZ: 0,
        normalX: 0,
        normalY: 1,
        normalZ: 0,
        relativeVelocity: 0,
        restitution: 0,
      });
    }

    const events = buf.drain();
    expect(events).toHaveLength(512);
    // Verify first and last event
    expect(events[0].entityA).toBe(0n);
    expect(events[511].entityA).toBe(511n);
  });

  it('500 dynamic bodies created < 20ms', () => {
    const start = performance.now();
    for (let i = 0; i < 500; i++) {
      useDynamicBody();
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(20);
  });

  it('500 onContact dispatches per frame < 1ms', () => {
    _clearContactCallbacks();
    const cb = vi.fn();
    onContact(cb);

    const event: Physics3DCollisionContact = {
      entityA: 1n,
      entityB: 2n,
      started: true,
    };

    const start = performance.now();
    for (let i = 0; i < 500; i++) {
      _dispatchContactEvent(event);
    }
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(1);
    expect(cb).toHaveBeenCalledTimes(500);
    _clearContactCallbacks();
  });
});

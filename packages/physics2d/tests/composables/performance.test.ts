/**
 * @file Performance tests for composables and ring buffer.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let _bodyIdCounter = 0;

const mockPhysics = {
  addRigidBody: vi.fn(() => ++_bodyIdCounter),
  addBoxCollider: vi.fn(),
  addBallCollider: vi.fn(),
  removeBody: vi.fn(),
  applyImpulse: vi.fn(),
  setLinearVelocity: vi.fn(),
  getLinearVelocity: vi.fn(() => ({ x: 0, y: 0 })),
};

vi.mock('../../src/composables.js', () => ({
  usePhysics2D: vi.fn(() => mockPhysics),
}));

vi.mock('@gwenjs/core/scene', () => ({
  _getActorEntityId: vi.fn(() => 1n),
}));

vi.mock('@gwenjs/core', () => ({
  useEngine: vi.fn(() => ({ getComponent: vi.fn(() => undefined) })),
}));

vi.mock('../../src/shape-component.js', () => ({
  ShapeComponent: { name: 'Shape', schema: {} },
}));

import { useStaticBody } from '../../src/composables/use-static-body.js';
import { ContactRingBuffer } from '../../src/ring-buffer.js';

describe('Performance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _bodyIdCounter = 0;
    mockPhysics.addRigidBody.mockImplementation(() => ++_bodyIdCounter);
  });

  it('creates 1000 static bodies in under 100ms', () => {
    const start = performance.now();
    for (let i = 0; i < 1_000; i++) {
      useStaticBody();
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(100);
  });

  it('drains 500 ring buffer events in under 0.5ms', () => {
    const buf = new ContactRingBuffer();
    for (let i = 0; i < 500; i++) {
      buf.write({
        entityAIdx: i,
        entityBIdx: i + 1,
        contactX: 0,
        contactY: 0,
        normalX: 1,
        normalY: 0,
        relativeVelocity: 5,
      });
    }
    const start = performance.now();
    buf.drain();
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(0.5);
  });

  it('applies 1000 impulses in under 5ms', async () => {
    const { useDynamicBody } = await import('../../src/composables/use-dynamic-body.js');
    const body = useDynamicBody();
    const start = performance.now();
    for (let i = 0; i < 1_000; i++) {
      body.applyImpulse(1, 0);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(5);
  });
});

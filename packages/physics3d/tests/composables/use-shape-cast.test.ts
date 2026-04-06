/**
 * Tests for useShapeCast() composable.
 *
 * Verifies that useShapeCast delegates to the correct Physics3D service methods
 * and that dispose() cleans up via unregisterShapeCastSlot.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockShapeCastHandle = {
  hit: false,
  entity: 0n,
  distance: 0,
  normal: { x: 0, y: 0, z: 0 },
  point: { x: 0, y: 0, z: 0 },
  witnessA: { x: 0, y: 0, z: 0 },
  witnessB: { x: 0, y: 0, z: 0 },
  _id: 43,
};

const mockPhysics3D = {
  registerShapeCastSlot: vi.fn(() => mockShapeCastHandle),
  unregisterShapeCastSlot: vi.fn(),
};

vi.mock('../../src/composables.js', () => ({
  usePhysics3D: vi.fn(() => mockPhysics3D),
}));

import { useShapeCast } from '../../src/composables/use-shape-cast.js';

describe('useShapeCast', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPhysics3D.registerShapeCastSlot.mockReturnValue(mockShapeCastHandle);
  });

  it('calls registerShapeCastSlot with the provided opts', () => {
    const opts = {
      shape: { type: 'sphere' as const, radius: 0.5 },
      direction: { x: 0, y: -1, z: 0 },
      maxDist: 10,
    };
    useShapeCast(opts);
    expect(mockPhysics3D.registerShapeCastSlot).toHaveBeenCalledWith(opts);
  });

  it('returns a handle with all ShapeCastHandle properties', () => {
    const handle = useShapeCast({
      shape: { type: 'sphere' as const, radius: 0.5 },
      direction: { x: 0, y: -1, z: 0 },
    });
    expect(handle.hit).toBe(false);
    expect(handle.entity).toBe(0n);
    expect(handle.distance).toBe(0);
    expect(handle.normal).toEqual({ x: 0, y: 0, z: 0 });
    expect(handle.point).toEqual({ x: 0, y: 0, z: 0 });
    expect(handle.witnessA).toEqual({ x: 0, y: 0, z: 0 });
    expect(handle.witnessB).toEqual({ x: 0, y: 0, z: 0 });
    expect(handle._id).toBe(43);
  });

  it('exposes reactive getters — reflects mutations to the underlying handle', () => {
    const liveHandle = { ...mockShapeCastHandle };
    mockPhysics3D.registerShapeCastSlot.mockReturnValue(liveHandle);
    const handle = useShapeCast({
      shape: { type: 'sphere' as const, radius: 0.3 },
      direction: { x: 1, y: 0, z: 0 },
    });

    liveHandle.hit = true;
    liveHandle.distance = 2.0;
    liveHandle.witnessA = { x: 1, y: 0, z: 0 };
    expect(handle.hit).toBe(true);
    expect(handle.distance).toBe(2.0);
    expect(handle.witnessA).toEqual({ x: 1, y: 0, z: 0 });
  });

  it('dispose() calls unregisterShapeCastSlot with the underlying handle', () => {
    const handle = useShapeCast({
      shape: { type: 'sphere' as const, radius: 0.5 },
      direction: { x: 0, y: -1, z: 0 },
    });
    handle.dispose();
    expect(mockPhysics3D.unregisterShapeCastSlot).toHaveBeenCalledWith(mockShapeCastHandle);
  });

  it('dispose() calls unregisterShapeCastSlot exactly once', () => {
    const handle = useShapeCast({
      shape: { type: 'sphere' as const, radius: 0.5 },
      direction: { x: 0, y: -1, z: 0 },
    });
    handle.dispose();
    expect(mockPhysics3D.unregisterShapeCastSlot).toHaveBeenCalledTimes(1);
  });

  it('registerShapeCastSlot is called exactly once per useShapeCast call', () => {
    useShapeCast({
      shape: { type: 'box' as const, hx: 1, hy: 1, hz: 1 },
      direction: { x: 0, y: 0, z: -1 },
    });
    expect(mockPhysics3D.registerShapeCastSlot).toHaveBeenCalledTimes(1);
  });
});

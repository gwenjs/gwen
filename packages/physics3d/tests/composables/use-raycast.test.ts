/**
 * Tests for useRaycast() composable.
 *
 * Verifies that useRaycast delegates to the correct Physics3D service methods
 * and that dispose() cleans up via unregisterRaycastSlot.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockRaycastHandle = {
  hit: false,
  entity: 0n,
  distance: 0,
  normal: { x: 0, y: 0, z: 0 },
  point: { x: 0, y: 0, z: 0 },
  _id: 42,
};

const mockPhysics3D = {
  registerRaycastSlot: vi.fn(() => mockRaycastHandle),
  unregisterRaycastSlot: vi.fn(),
};

vi.mock('../../src/composables.js', () => ({
  usePhysics3D: vi.fn(() => mockPhysics3D),
}));

import { useRaycast } from '../../src/composables/use-raycast.js';

describe('useRaycast', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPhysics3D.registerRaycastSlot.mockReturnValue(mockRaycastHandle);
  });

  it('calls registerRaycastSlot with the provided opts', () => {
    const opts = { direction: { x: 0, y: -1, z: 0 }, maxDist: 5 };
    useRaycast(opts);
    expect(mockPhysics3D.registerRaycastSlot).toHaveBeenCalledWith(opts);
  });

  it('returns a handle with all RaycastHandle properties', () => {
    const handle = useRaycast({ direction: { x: 0, y: -1, z: 0 } });
    expect(handle.hit).toBe(false);
    expect(handle.entity).toBe(0n);
    expect(handle.distance).toBe(0);
    expect(handle.normal).toEqual({ x: 0, y: 0, z: 0 });
    expect(handle.point).toEqual({ x: 0, y: 0, z: 0 });
    expect(handle._id).toBe(42);
  });

  it('exposes reactive getters — reflects mutations to the underlying handle', () => {
    const liveHandle = { ...mockRaycastHandle };
    mockPhysics3D.registerRaycastSlot.mockReturnValue(liveHandle);
    const handle = useRaycast({ direction: { x: 1, y: 0, z: 0 } });

    liveHandle.hit = true;
    liveHandle.distance = 3.5;
    expect(handle.hit).toBe(true);
    expect(handle.distance).toBe(3.5);
  });

  it('dispose() calls unregisterRaycastSlot with the underlying handle', () => {
    const handle = useRaycast({ direction: { x: 0, y: -1, z: 0 } });
    handle.dispose();
    expect(mockPhysics3D.unregisterRaycastSlot).toHaveBeenCalledWith(mockRaycastHandle);
  });

  it('dispose() calls unregisterRaycastSlot exactly once', () => {
    const handle = useRaycast({ direction: { x: 0, y: -1, z: 0 } });
    handle.dispose();
    expect(mockPhysics3D.unregisterRaycastSlot).toHaveBeenCalledTimes(1);
  });

  it('registerRaycastSlot is called exactly once per useRaycast call', () => {
    useRaycast({ direction: { x: 0, y: 0, z: -1 } });
    expect(mockPhysics3D.registerRaycastSlot).toHaveBeenCalledTimes(1);
  });
});

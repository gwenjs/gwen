/**
 * Tests for useOverlap() composable.
 *
 * Verifies that useOverlap delegates to the correct Physics3D service methods
 * and that dispose() cleans up via unregisterOverlapSlot.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockOverlapHandle = {
  count: 0,
  entities: [] as bigint[],
  _id: 44,
};

const mockPhysics3D = {
  registerOverlapSlot: vi.fn(() => mockOverlapHandle),
  unregisterOverlapSlot: vi.fn(),
};

vi.mock('../../src/composables.js', () => ({
  usePhysics3D: vi.fn(() => mockPhysics3D),
}));

import { useOverlap } from '../../src/composables/use-overlap.js';

describe('useOverlap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOverlapHandle.count = 0;
    mockOverlapHandle.entities = [];
    mockPhysics3D.registerOverlapSlot.mockReturnValue(mockOverlapHandle);
  });

  it('calls registerOverlapSlot with the provided opts', () => {
    const origin = () => ({ x: 0, y: 0, z: 0 });
    const opts = {
      shape: { type: 'box' as const, hx: 2, hy: 1, hz: 2 },
      origin,
      maxResults: 8,
    };
    useOverlap(opts);
    expect(mockPhysics3D.registerOverlapSlot).toHaveBeenCalledWith(opts);
  });

  it('returns a handle with all OverlapHandle properties', () => {
    const handle = useOverlap({
      shape: { type: 'sphere' as const, radius: 1 },
      origin: () => ({ x: 0, y: 0, z: 0 }),
    });
    expect(handle.count).toBe(0);
    expect(handle.entities).toEqual([]);
    expect(handle._id).toBe(44);
  });

  it('exposes reactive getters — reflects mutations to the underlying handle', () => {
    const liveHandle = { count: 0, entities: [] as bigint[], _id: 44 };
    mockPhysics3D.registerOverlapSlot.mockReturnValue(liveHandle);
    const handle = useOverlap({
      shape: { type: 'sphere' as const, radius: 1 },
      origin: () => ({ x: 0, y: 0, z: 0 }),
    });

    liveHandle.count = 2;
    liveHandle.entities = [1n, 2n];
    expect(handle.count).toBe(2);
    expect(handle.entities).toEqual([1n, 2n]);
  });

  it('dispose() calls unregisterOverlapSlot with the underlying handle', () => {
    const handle = useOverlap({
      shape: { type: 'box' as const, hx: 1, hy: 1, hz: 1 },
      origin: () => ({ x: 1, y: 0, z: 1 }),
    });
    handle.dispose();
    expect(mockPhysics3D.unregisterOverlapSlot).toHaveBeenCalledWith(mockOverlapHandle);
  });

  it('dispose() calls unregisterOverlapSlot exactly once', () => {
    const handle = useOverlap({
      shape: { type: 'sphere' as const, radius: 0.5 },
      origin: () => ({ x: 0, y: 0, z: 0 }),
    });
    handle.dispose();
    expect(mockPhysics3D.unregisterOverlapSlot).toHaveBeenCalledTimes(1);
  });

  it('registerOverlapSlot is called exactly once per useOverlap call', () => {
    useOverlap({
      shape: { type: 'sphere' as const, radius: 2 },
      origin: () => ({ x: 5, y: 0, z: 5 }),
    });
    expect(mockPhysics3D.registerOverlapSlot).toHaveBeenCalledTimes(1);
  });
});

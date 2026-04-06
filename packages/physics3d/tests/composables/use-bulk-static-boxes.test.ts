import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { EntityId } from '@gwenjs/core';
import type { BulkStaticBoxesResult } from '../../src/types.js';

vi.mock('@gwenjs/core/scene', () => ({
  _getActorEntityId: vi.fn(() => 0n),
}));

const mockResult: BulkStaticBoxesResult = {
  entityIds: [0n as EntityId, 1n as EntityId],
  count: 2,
};

const mockPhysics3D = {
  bulkSpawnStaticBoxes: vi.fn(() => mockResult),
};

vi.mock('../../src/composables.js', () => ({
  usePhysics3D: vi.fn(() => mockPhysics3D),
}));

import { useBulkStaticBoxes } from '../../src/composables/use-bulk-static-boxes.js';

describe('useBulkStaticBoxes', () => {
  const positions = new Float32Array([0, 0, 0, 5, 0, 0]);
  const halfExtents = new Float32Array([0.5, 0.5, 0.5]);

  beforeEach(() => {
    vi.clearAllMocks();
    mockPhysics3D.bulkSpawnStaticBoxes.mockReturnValue(mockResult);
  });

  it('calls physics3d.bulkSpawnStaticBoxes with correct options', () => {
    useBulkStaticBoxes({ positions, halfExtents });
    expect(mockPhysics3D.bulkSpawnStaticBoxes).toHaveBeenCalledWith(
      expect.objectContaining({ positions, halfExtents }),
    );
  });

  it('returns the BulkStaticBoxesResult from the service', () => {
    const result = useBulkStaticBoxes({ positions, halfExtents });
    expect(result.count).toBe(2);
    expect(result.entityIds).toHaveLength(2);
  });

  it('forwards friction and restitution to the service', () => {
    useBulkStaticBoxes({ positions, halfExtents, friction: 0.9, restitution: 0.2 });
    expect(mockPhysics3D.bulkSpawnStaticBoxes).toHaveBeenCalledWith(
      expect.objectContaining({ friction: 0.9, restitution: 0.2 }),
    );
  });

  it('forwards layers and mask to the service', () => {
    useBulkStaticBoxes({
      positions,
      halfExtents,
      layers: ['ground'],
      mask: ['player', 'enemy'],
    });
    expect(mockPhysics3D.bulkSpawnStaticBoxes).toHaveBeenCalledWith(
      expect.objectContaining({ layers: ['ground'], mask: ['player', 'enemy'] }),
    );
  });
});

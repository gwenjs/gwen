import { describe, expect, it } from 'vitest';
import type { TilemapChunkOrchestrator, PhysicsEntitySnapshot } from '../src/types';

describe('helper contracts', () => {
  it('accepts a valid TilemapChunkOrchestrator shape', () => {
    const orchestrator: TilemapChunkOrchestrator = {
      syncVisibleChunks() {},
      patchChunk() {},
      dispose() {},
    };

    expect(typeof orchestrator.syncVisibleChunks).toBe('function');
    expect(typeof orchestrator.patchChunk).toBe('function');
    expect(typeof orchestrator.dispose).toBe('function');
  });

  it('accepts nullable snapshot fields', () => {
    const snapshot: PhysicsEntitySnapshot = {
      entityId: BigInt(7) as import('@gwenjs/core').EntityId,
      position: null,
      velocity: null,
    };

    expect(snapshot.entityId).toBe(BigInt(7));
    expect(snapshot.position).toBeNull();
    expect(snapshot.velocity).toBeNull();
  });
});

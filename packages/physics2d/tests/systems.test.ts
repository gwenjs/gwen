/**
 * Tests for @gwenjs/physics2d — systems.ts
 *
 * Strategy: mock the engine and Physics2D API entirely so tests run in Node.js
 * without a real WASM module. The live-query integration is verified by
 * controlling what `engine.createLiveQuery` returns on each call.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import type { EntityId } from '@gwenjs/core';
import {
  createPhysicsKinematicSyncSystem,
  createPlatformerGroundedSystem,
  SENSOR_ID_FOOT,
} from '../src/systems';
import type {
  PhysicsKinematicSyncSystemOptions,
  PlatformerGroundedSystemOptions,
} from '../src/systems';
import type { Physics2DAPI, SensorState } from '../src/types';

// ─── Mock factories ───────────────────────────────────────────────────────────

/** Creates a minimal Physics2DAPI mock. */
function makePhysicsMock(): Pick<
  Physics2DAPI,
  'setKinematicPosition' | 'getSensorState' | 'updateSensorState'
> &
  Record<string, Mock> {
  return {
    setKinematicPosition: vi.fn(),
    getSensorState: vi.fn(
      (_id: EntityId, _colliderId: number): SensorState => ({
        contactCount: 0,
        isActive: false,
      }),
    ),
    updateSensorState: vi.fn(),
  };
}

/**
 * Creates a minimal engine mock that simulates `engine.inject` and
 * `engine.createLiveQuery`. The live query is backed by an in-memory array
 * that can be swapped between test steps.
 */
function makeEngineMock(physicsMock: ReturnType<typeof makePhysicsMock>) {
  /**
   * The current set of entity accessors the live query will yield.
   * Tests manipulate this array directly to simulate add/remove.
   */
  const entityAccessors: Array<{
    id: EntityId;
    get: Mock;
  }> = [];

  const engine = {
    inject: vi.fn((_key: string) => physicsMock),
    createLiveQuery: vi.fn(() => ({
      [Symbol.iterator]() {
        // Re-read the array on every iteration to simulate a live query.
        let index = 0;
        return {
          next() {
            if (index < entityAccessors.length) {
              return { done: false as const, value: entityAccessors[index++]! };
            }
            return { done: true as const, value: undefined };
          },
        };
      },
    })),
    /** Test helper — add an entity to the live query results. */
    _addEntity(id: EntityId, position: { x: number; y: number } | null) {
      entityAccessors.push({
        id,
        get: vi.fn(() => position),
      });
    },
    /** Test helper — remove an entity from the live query results by ID. */
    _removeEntity(id: EntityId) {
      const idx = entityAccessors.findIndex((e) => e.id === id);
      if (idx !== -1) entityAccessors.splice(idx, 1);
    },
    /** Test helper — update the position returned for an existing entity. */
    _setPosition(id: EntityId, position: { x: number; y: number } | null) {
      const accessor = entityAccessors.find((e) => e.id === id);
      if (accessor) accessor.get.mockReturnValue(position);
    },
  };

  return { engine, entityAccessors };
}

// ─── Physics2DKinematicSyncSystem — live query integration ────────────────────

describe('Physics2DKinematicSyncSystem', () => {
  describe('live query integration', () => {
    it('only iterates entities with both required components', () => {
      const physics = makePhysicsMock();
      const { engine } = makeEngineMock(physics);

      // One entity with a valid position, one with null (missing component).
      engine._addEntity(1n as EntityId, { x: 100, y: 200 });
      engine._addEntity(2n as EntityId, null);

      const system = createPhysicsKinematicSyncSystem({ pixelsPerMeter: 50 });
      system.setup(engine as Parameters<typeof system.setup>[0]);
      system.onBeforeUpdate(0);

      // Only entity 1 has a valid Vec2 position — entity 2 returns null.
      expect(physics.setKinematicPosition).toHaveBeenCalledTimes(1);
      expect(physics.setKinematicPosition).toHaveBeenCalledWith(1n as EntityId, 100 / 50, 200 / 50);
    });

    it('picks up newly added entities on the next frame', () => {
      const physics = makePhysicsMock();
      const { engine } = makeEngineMock(physics);

      engine._addEntity(10n as EntityId, { x: 50, y: 50 });

      const system = createPhysicsKinematicSyncSystem({ pixelsPerMeter: 50 });
      system.setup(engine as Parameters<typeof system.setup>[0]);

      // Frame 1 — only entity 10.
      system.onBeforeUpdate(0);
      expect(physics.setKinematicPosition).toHaveBeenCalledTimes(1);

      vi.clearAllMocks();

      // Add a second entity and advance one more frame.
      engine._addEntity(20n as EntityId, { x: 150, y: 75 });
      system.onBeforeUpdate(0);

      expect(physics.setKinematicPosition).toHaveBeenCalledTimes(2);
      expect(physics.setKinematicPosition).toHaveBeenCalledWith(10n as EntityId, 50 / 50, 50 / 50);
      expect(physics.setKinematicPosition).toHaveBeenCalledWith(20n as EntityId, 150 / 50, 75 / 50);
    });

    it('drops removed entities from the query on the next frame', () => {
      const physics = makePhysicsMock();
      const { engine } = makeEngineMock(physics);

      engine._addEntity(5n as EntityId, { x: 10, y: 20 });
      engine._addEntity(6n as EntityId, { x: 30, y: 40 });

      const system = createPhysicsKinematicSyncSystem({ pixelsPerMeter: 50 });
      system.setup(engine as Parameters<typeof system.setup>[0]);

      // Frame 1 — both entities synced.
      system.onBeforeUpdate(0);
      expect(physics.setKinematicPosition).toHaveBeenCalledTimes(2);

      vi.clearAllMocks();

      // Remove entity 5; only entity 6 should be synced next frame.
      engine._removeEntity(5n as EntityId);
      system.onBeforeUpdate(0);

      expect(physics.setKinematicPosition).toHaveBeenCalledTimes(1);
      expect(physics.setKinematicPosition).toHaveBeenCalledWith(6n as EntityId, 30 / 50, 40 / 50);
    });
  });

  // ─── Options & defaults ─────────────────────────────────────────────────────

  describe('options', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('uses default pixelsPerMeter of 50 when not specified', () => {
      const physics = makePhysicsMock();
      const { engine } = makeEngineMock(physics);
      engine._addEntity(1n as EntityId, { x: 100, y: 200 });

      const system = createPhysicsKinematicSyncSystem();
      system.setup(engine as Parameters<typeof system.setup>[0]);
      system.onBeforeUpdate(0);

      // Default ppm = 50: 100/50 = 2, 200/50 = 4.
      expect(physics.setKinematicPosition).toHaveBeenCalledWith(1n as EntityId, 2, 4);
    });

    it('respects a custom pixelsPerMeter', () => {
      const physics = makePhysicsMock();
      const { engine } = makeEngineMock(physics);
      engine._addEntity(1n as EntityId, { x: 100, y: 200 });

      const system = createPhysicsKinematicSyncSystem({ pixelsPerMeter: 100 });
      system.setup(engine as Parameters<typeof system.setup>[0]);
      system.onBeforeUpdate(0);

      // ppm = 100: 100/100 = 1, 200/100 = 2.
      expect(physics.setKinematicPosition).toHaveBeenCalledWith(1n as EntityId, 1, 2);
    });

    it('passes the configured positionComponent name to createLiveQuery', () => {
      const physics = makePhysicsMock();
      const { engine } = makeEngineMock(physics);

      const opts: PhysicsKinematicSyncSystemOptions = { positionComponent: 'transform2d' };
      const system = createPhysicsKinematicSyncSystem(opts);
      system.setup(engine as Parameters<typeof system.setup>[0]);

      // createLiveQuery should have been called with the custom component name.
      expect(engine.createLiveQuery).toHaveBeenCalledWith(expect.arrayContaining(['transform2d']));
    });
  });

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  describe('lifecycle', () => {
    it('is a no-op on onBeforeUpdate before setup is called', () => {
      const physics = makePhysicsMock();
      const system = createPhysicsKinematicSyncSystem();
      // Deliberately skip setup.
      system.onBeforeUpdate(0);
      expect(physics.setKinematicPosition).not.toHaveBeenCalled();
    });

    it('stops syncing after teardown', () => {
      const physics = makePhysicsMock();
      const { engine } = makeEngineMock(physics);
      engine._addEntity(1n as EntityId, { x: 10, y: 20 });

      const system = createPhysicsKinematicSyncSystem();
      system.setup(engine as Parameters<typeof system.setup>[0]);
      system.teardown();
      system.onBeforeUpdate(0);

      expect(physics.setKinematicPosition).not.toHaveBeenCalled();
    });

    it('has the plugin name "PhysicsKinematicSyncSystem"', () => {
      const system = createPhysicsKinematicSyncSystem();
      expect(system.name).toBe('PhysicsKinematicSyncSystem');
    });
  });
});

// ─── SENSOR_ID_FOOT constant ──────────────────────────────────────────────────

describe('SENSOR_ID_FOOT', () => {
  it('equals 0xf007', () => {
    expect(SENSOR_ID_FOOT).toBe(0xf007);
  });
});

// ─── createPlatformerGroundedSystem ──────────────────────────────────────────

describe('createPlatformerGroundedSystem', () => {
  let physics: ReturnType<typeof makePhysicsMock>;

  beforeEach(() => {
    physics = makePhysicsMock();
    vi.clearAllMocks();
  });

  it('isGrounded returns true when the foot sensor is active', () => {
    (physics.getSensorState as Mock).mockReturnValue({
      contactCount: 1,
      isActive: true,
    } satisfies SensorState);

    const grounded = createPlatformerGroundedSystem({
      physics: physics as unknown as Physics2DAPI,
    });
    expect(grounded.isGrounded(1n as EntityId)).toBe(true);
  });

  it('isGrounded returns false when the foot sensor is inactive', () => {
    (physics.getSensorState as Mock).mockReturnValue({
      contactCount: 0,
      isActive: false,
    } satisfies SensorState);

    const grounded = createPlatformerGroundedSystem({
      physics: physics as unknown as Physics2DAPI,
    });
    expect(grounded.isGrounded(1n as EntityId)).toBe(false);
  });

  it('getSensorState returns the full sensor state object', () => {
    const state: SensorState = { contactCount: 3, isActive: true };
    (physics.getSensorState as Mock).mockReturnValue(state);

    const grounded = createPlatformerGroundedSystem({
      physics: physics as unknown as Physics2DAPI,
    });
    expect(grounded.getSensorState(1n as EntityId)).toStrictEqual(state);
  });

  it('uses the default SENSOR_ID_FOOT when no sensorId is supplied', () => {
    const grounded = createPlatformerGroundedSystem({
      physics: physics as unknown as Physics2DAPI,
    });
    grounded.isGrounded(2n as EntityId);

    expect(physics.getSensorState).toHaveBeenCalledWith(2n as EntityId, SENSOR_ID_FOOT);
  });

  it('uses a custom sensorId when one is provided', () => {
    const customId = 0xbeef;
    const opts: PlatformerGroundedSystemOptions = { sensorId: customId };
    const grounded = createPlatformerGroundedSystem({
      ...opts,
      physics: physics as unknown as Physics2DAPI,
    });
    grounded.isGrounded(3n as EntityId);

    expect(physics.getSensorState).toHaveBeenCalledWith(3n as EntityId, customId);
  });
});

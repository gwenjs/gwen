/// <reference types="vite/client" />

/**
 * @gwenjs/physics2d
 *
 * 2D physics plugin for GWEN — pure adapter providing 2D rigid-body physics via the core WASM.
 */

import { definePlugin } from '@gwenjs/kit';
import { unpackEntityId, createEntityId, getWasmBridge } from '@gwenjs/core';
import type { GwenEngine, EntityId, WasmBridge, WasmEnginePhysics2D } from '@gwenjs/core';

import type {
  Physics2DConfig,
  Physics2DAPI,
  CollisionEventsBatch,
  Physics2DPrefabExtension,
  Physics2DPluginHooks,
  CollisionContact,
} from '../types';

import {
  BODY_TYPE,
  PHYSICS2D_BRIDGE_SCHEMA_VERSION,
  PHYSICS_QUALITY_PRESET_CODE,
  PHYSICS2D_WASM_EVENT_STRIDE,
} from '../types';

// ─── Internal types ──────────────────────────────────────────────────────────

/**
 * Internal representation of a raw WASM collision event.
 * Carries slot indices that are never exposed on the public `CollisionEvent` type.
 * Used exclusively within this file for event pool management and resolution.
 */
type InternalCollisionEvent = {
  slotA: number;
  slotB: number;
  aColliderId?: number;
  bColliderId?: number;
  started: boolean;
};

import {
  normalizeConfig,
  LayerRegistry,
  resolveGlobalCcdEnabled,
  PIXELS_PER_METER,
} from '../config';

import { addPrefabCollider } from '../prefab';
import { tilemapChunkIdFromKey, tilemapPseudoEntityFromChunkId } from '../utils';

// Public exports
export {
  createPhysicsKinematicSyncSystem,
  createPlatformerGroundedSystem,
  SENSOR_ID_FOOT,
} from '../systems';
export { buildTilemapPhysicsChunks, patchTilemapPhysicsChunk } from '../helpers/tilemap';
export type {
  PhysicsKinematicSyncSystemOptions,
  PlatformerGroundedSystemOptions,
} from '../systems';

// Re-export public types
export type {
  Physics2DConfig,
  Physics2DAPI,
  CollisionEvent,
  CollisionEventsBatch,
  CollisionContact,
  ColliderOptions,
  RigidBodyType,
  Physics2DPrefabExtension,
  Physics2DPluginHooks,
  PhysicsColliderDef,
  PhysicsQualityPreset,
  PhysicsColliderShape,
  SensorState,
  TilemapPhysicsChunkMap,
} from '../types';

export {
  PHYSICS2D_BRIDGE_SCHEMA_VERSION,
  PHYSICS_QUALITY_PRESET_CODE,
  PHYSICS2D_WASM_EVENT_STRIDE,
};

// ─── Constants ───────────────────────────────────────────────────────────────

const EVENT_STRIDE = PHYSICS2D_WASM_EVENT_STRIDE;
const MAX_EVENTS = 512;

function processSensorId(
  activeSensors: Map<number, Set<number>>,
  slot: number,
  reportedId?: number,
): number | undefined {
  const entitySensors = activeSensors.get(slot);
  if (!entitySensors) return reportedId;
  if (reportedId !== undefined) return entitySensors.has(reportedId) ? reportedId : undefined;
  return entitySensors.size === 1 ? entitySensors.values().next().value : undefined;
}

// ─── Plugin implementation ───────────────────────────────────────────────────

/**
 * GWEN plugin providing 2D rigid-body physics via Rapier2D integrated in the core WASM.
 */
export const Physics2DPlugin = definePlugin((config: Physics2DConfig = {}) => {
  const cfg = normalizeConfig(config);
  const layerRegistry = new LayerRegistry(cfg.layers);

  // State management
  const loadedTilemapChunks = new Map<string, { chunkId: number; checksum: string }>();
  const activeSensors = new Map<number, Set<number>>();
  const entityCollisionCallbacks = new Map<
    number,
    NonNullable<Physics2DPrefabExtension['onCollision']>
  >();

  // Physics bridge reference — typed as WasmBridge since getWasmBridge() always returns it.
  let bridge: WasmBridge | null = null;
  let currentEngine: GwenEngine | null = null;
  let physicsService: Physics2DAPI | null = null;

  // Binary buffer state (encapsulated per plugin instance)
  let eventsView: DataView | null = null;
  let eventsBufferRef: ArrayBuffer | null = null;
  const pooledCollisionEvents: InternalCollisionEvent[] = [];
  let cachedCollisionBatch: CollisionEventsBatch | null = null;

  /**
   * Reads pending collision events from the static WASM buffer.
   */
  function readCollisionEvents(max?: number): CollisionEventsBatch {
    if (cachedCollisionBatch && max === undefined) {
      return cachedCollisionBatch;
    }

    const pb = bridge!.getPhysicsBridge() as WasmEnginePhysics2D;
    const memory = bridge!.getLinearMemory();
    if (!memory) {
      return {
        frame: 0,
        count: 0,
        droppedSinceLastRead: 0,
        droppedCritical: 0,
        droppedNonCritical: 0,
        coalesced: false,
        events: [],
      };
    }
    const ptr = pb.physics_get_collision_events_ptr();
    const count = pb.physics_get_collision_event_count();

    if (!eventsView || eventsBufferRef !== memory.buffer || eventsView.byteLength === 0) {
      eventsBufferRef = memory.buffer;
      eventsView = new DataView(memory.buffer, ptr, MAX_EVENTS * EVENT_STRIDE);
    }

    const visibleCount = max !== undefined && max >= 0 ? Math.min(max, count) : count;

    pooledCollisionEvents.length = visibleCount;
    for (let i = 0; i < visibleCount; i++) {
      const offset = i * EVENT_STRIDE;
      const type = eventsView.getUint32(offset + 8, true);

      let ev = pooledCollisionEvents[i];
      if (!ev) {
        ev = { slotA: 0, slotB: 0, started: false } satisfies InternalCollisionEvent;
        pooledCollisionEvents[i] = ev;
      }

      ev.slotA = eventsView.getUint32(offset, true);
      ev.slotB = eventsView.getUint32(offset + 4, true);
      ev.started = type === 0 || type === 2;

      const aId = eventsView.getUint16(offset + 12, true);
      const bId = eventsView.getUint16(offset + 14, true);
      if (aId === 0xffff) delete ev.aColliderId;
      else ev.aColliderId = aId;
      if (bId === 0xffff) delete ev.bColliderId;
      else ev.bColliderId = bId;
    }

    const metrics = pb.physics_consume_event_metrics
      ? pb.physics_consume_event_metrics()
      : [0, 0, 0, 0];
    const batch: CollisionEventsBatch = {
      frame: metrics[0] ?? 0,
      count: visibleCount,
      droppedSinceLastRead: (metrics[1] ?? 0) + (metrics[2] ?? 0),
      droppedCritical: metrics[1] ?? 0,
      droppedNonCritical: metrics[2] ?? 0,
      coalesced: metrics[3] === 1,
      events: pooledCollisionEvents,
    };

    if (max === undefined) cachedCollisionBatch = batch;
    return batch;
  }

  /** Build the public Physics2DAPI using the currently-active bridge (set in setup). */
  function createAPI(): Physics2DAPI {
    const pb = bridge!.getPhysicsBridge() as WasmEnginePhysics2D;
    /** Extract raw slot index from packed EntityId (bigint) or legacy raw slot number. */
    const slot = (id: import('@gwenjs/core').EntityId | number) =>
      typeof id === 'number' ? id : unpackEntityId(id).index;
    const resolveContacts = (events: ReadonlyArray<InternalCollisionEvent>): CollisionContact[] => {
      const out: CollisionContact[] = [];
      for (const ev of events) {
        const genA = bridge!.getEntityGeneration(ev.slotA);
        const genB = bridge!.getEntityGeneration(ev.slotB);
        if (genA === undefined || genB === undefined) continue;
        out.push({
          entityA: createEntityId(ev.slotA, genA),
          entityB: createEntityId(ev.slotB, genB),
          ...(ev.aColliderId !== undefined ? { aColliderId: ev.aColliderId } : {}),
          ...(ev.bColliderId !== undefined ? { bColliderId: ev.bColliderId } : {}),
          started: ev.started,
        });
      }
      return out;
    };
    return {
      isDebugEnabled: () => cfg.debug,
      addRigidBody: (entityId, type, x, y, opts = {}) => {
        const s = slot(entityId);
        const handle = pb.physics_add_rigid_body(
          s,
          x,
          y,
          BODY_TYPE[type],
          opts.mass ?? 1.0,
          opts.gravityScale ?? 1.0,
          opts.linearDamping ?? 0.0,
          opts.angularDamping ?? 0.0,
          opts.initialVelocity?.vx ?? 0.0,
          opts.initialVelocity?.vy ?? 0.0,
          opts.ccdEnabled === undefined ? undefined : opts.ccdEnabled ? 1 : 0,
          opts.additionalSolverIterations,
        );
        if (cfg.debug)
          console.log(
            `[Physics2D] addRigidBody entity=${s} type=${type} x=${x.toFixed(3)} y=${y.toFixed(3)} -> handle=${handle}`,
          );
        return handle;
      },
      addBoxCollider: (handle, hw, hh, opts = {}) =>
        pb.physics_add_box_collider(
          handle,
          hw,
          hh,
          opts.restitution ?? 0,
          opts.friction ?? 0.5,
          opts.isSensor ? 1 : 0,
          opts.density ?? 1.0,
          typeof opts.membershipLayers === 'number'
            ? opts.membershipLayers
            : layerRegistry.resolve(opts.membershipLayers as string[] | undefined, 'membership'),
          typeof opts.filterLayers === 'number'
            ? opts.filterLayers
            : layerRegistry.resolve(opts.filterLayers as string[] | undefined, 'filter'),
          opts.colliderId,
          opts.offsetX,
          opts.offsetY,
        ),
      addBallCollider: (handle, radius, opts = {}) =>
        pb.physics_add_ball_collider(
          handle,
          radius,
          opts.restitution ?? 0,
          opts.friction ?? 0.5,
          opts.isSensor ? 1 : 0,
          opts.density ?? 1.0,
          typeof opts.membershipLayers === 'number'
            ? opts.membershipLayers
            : layerRegistry.resolve(opts.membershipLayers as string[] | undefined, 'membership'),
          typeof opts.filterLayers === 'number'
            ? opts.filterLayers
            : layerRegistry.resolve(opts.filterLayers as string[] | undefined, 'filter'),
          opts.colliderId,
          opts.offsetX,
          opts.offsetY,
        ),
      removeBody: (entityId) => pb.physics_remove_rigid_body(slot(entityId)),
      setKinematicPosition: (entityId, x, y) => {
        pb.physics_set_kinematic_position(slot(entityId), x, y, 0);
      },
      setKinematicPositionWithAngle: (entityId, x, y, angle) =>
        pb.physics_set_kinematic_position(slot(entityId), x, y, angle) === 1,
      bulkStepKinematics: (slots, vx, vy, dt) => pb.physics_bulk_step_kinematics(slots, vx, vy, dt),
      applyImpulse: (entityId, x, y) => pb.physics_apply_impulse(slot(entityId), x, y),
      setLinearVelocity: (entityId, vx, vy) =>
        pb.physics_set_linear_velocity(slot(entityId), vx, vy),
      getLinearVelocity: (entityId) => {
        const res = pb.physics_get_linear_velocity(slot(entityId));
        return res ? { x: res[0], y: res[1] } : null;
      },
      getPosition: (entityId) => {
        const res = pb.physics_get_position(slot(entityId));
        if (!res || res.length === 0) return null;
        return { x: res[0], y: res[1], rotation: res[2] };
      },
      getSensorState: (entityId, colliderId) => {
        const res = pb.physics_get_sensor_state(slot(entityId), colliderId);
        if (!res || res.length === 0) return { contactCount: 0, isActive: false };
        return { contactCount: res[0], isActive: res[1] !== 0 };
      },
      updateSensorState: (entityId, colliderId, active) =>
        pb.physics_update_sensor_state(slot(entityId), colliderId, active ? 1 : 0),
      getCollisionEventsBatch: (opts) => readCollisionEvents(opts?.max),
      getCollisionContacts: (opts) => {
        const batch = readCollisionEvents(opts?.max);
        return resolveContacts(batch.events as unknown as InternalCollisionEvent[]);
      },
      buildNavmesh: () =>
        pb.physics_build_navmesh ? pb.physics_build_navmesh() : pb.build_navmesh?.(),
      findPath: (from, to) => {
        const count = pb.path_find_2d(from.x, from.y, to.x, to.y);
        const ptr = pb.path_get_result_ptr();
        const memory = bridge!.getLinearMemory();
        if (!memory) return [];
        const view = new Float32Array(memory.buffer, ptr, count * 2);
        const path: Array<{ x: number; y: number }> = [];
        for (let i = 0; i < count; i++) {
          path.push({ x: view[i * 2] ?? 0, y: view[i * 2 + 1] ?? 0 });
        }
        return path;
      },
      loadTilemapPhysicsChunk(chunk, x, y, opts = {}) {
        const existing = loadedTilemapChunks.get(chunk.key);
        if (existing?.checksum === chunk.checksum) return;
        if (existing) {
          pb.physics_unload_tilemap_chunk_body(existing.chunkId);
          loadedTilemapChunks.delete(chunk.key);
        }
        const chunkId = tilemapChunkIdFromKey(chunk.key);
        const pseudoEntityIndex = tilemapPseudoEntityFromChunkId(chunkId);
        const bodyHandle = pb.physics_load_tilemap_chunk_body(chunkId, pseudoEntityIndex, x, y);
        if (!opts.debugNaive) {
          for (const [colliderIndex, collider] of chunk.colliders.entries())
            addPrefabCollider(
              physicsService!,
              bodyHandle,
              collider,
              layerRegistry,
              colliderIndex,
              0.5,
            );
        }
        loadedTilemapChunks.set(chunk.key, { chunkId, checksum: chunk.checksum });
      },
      unloadTilemapPhysicsChunk(key) {
        const loaded = loadedTilemapChunks.get(key);
        if (!loaded) return;
        pb.physics_unload_tilemap_chunk_body(loaded.chunkId);
        loadedTilemapChunks.delete(key);
      },
      patchTilemapPhysicsChunk(chunk, x, y, opts) {
        this.unloadTilemapPhysicsChunk(chunk.key);
        this.loadTilemapPhysicsChunk(chunk, x, y, opts);
      },
    };
  }

  return {
    name: '@gwenjs/physics2d',
    provides: { physics: {} as Physics2DAPI },
    providesHooks: {} as Physics2DPluginHooks,
    extensions: { prefab: {} as Physics2DPrefabExtension },

    // ── Lifecycle ──────────────────────────────────────────────────────

    setup(engine: GwenEngine): void {
      bridge = getWasmBridge();

      if (!bridge.hasPhysics()) {
        throw new Error('[Physics2D] Core WASM variant does not include physics.');
      }

      const pb = bridge.getPhysicsBridge() as WasmEnginePhysics2D;
      pb.physics_init(cfg.gravityX, cfg.gravity, cfg.maxEntities);
      pb.physics_set_quality(PHYSICS_QUALITY_PRESET_CODE[cfg.qualityPreset]);
      pb.physics_set_event_coalescing(cfg.coalesceEvents ? 1 : 0);
      pb.physics_set_global_ccd_enabled(resolveGlobalCcdEnabled(cfg) ? 1 : 0);

      physicsService = createAPI();
      engine.provide('physics2d', physicsService!);

      engine.hooks.hook('prefab:instantiate', (entityId, extensions) => {
        const ext = extensions?.physics;
        if (!ext) return;

        const { index: slot } = unpackEntityId(entityId);

        const handle = physicsService!.addRigidBody(entityId, ext.bodyType ?? 'dynamic', 0, 0, {
          ...(ext.mass !== undefined ? { mass: ext.mass } : {}),
          ...(ext.gravityScale !== undefined ? { gravityScale: ext.gravityScale } : {}),
          ...(ext.linearDamping !== undefined ? { linearDamping: ext.linearDamping } : {}),
          ...(ext.angularDamping !== undefined ? { angularDamping: ext.angularDamping } : {}),
          ...(ext.initialVelocity
            ? {
                initialVelocity: {
                  vx: ext.initialVelocity.vx / PIXELS_PER_METER,
                  vy: ext.initialVelocity.vy / PIXELS_PER_METER,
                },
              }
            : {}),
          ...(ext.ccdEnabled !== undefined ? { ccdEnabled: ext.ccdEnabled } : {}),
          ...(ext.additionalSolverIterations !== undefined
            ? { additionalSolverIterations: ext.additionalSolverIterations }
            : {}),
        });

        if (Array.isArray(ext.colliders)) {
          const sensors = new Set<number>();
          for (const [idx, collider] of ext.colliders.entries()) {
            const colliderId = collider.colliderId ?? idx;
            addPrefabCollider(physicsService!, handle, collider, layerRegistry, colliderId, 0);
            if (collider.isSensor) sensors.add(colliderId);
          }
          if (sensors.size > 0) activeSensors.set(slot, sensors);
        } else {
          throw new Error(
            '[Physics2D] Prefab extension must declare `extensions.physics.colliders[]` in v2.',
          );
        }

        if (ext.onCollision) entityCollisionCallbacks.set(slot, ext.onCollision);
      });

      engine.hooks.hook('entity:destroy', (entityId: EntityId) => {
        const { index: slot } = unpackEntityId(entityId);
        entityCollisionCallbacks.delete(slot);
        activeSensors.delete(slot);
        physicsService?.removeBody(entityId);
      });

      currentEngine = engine;
    },

    onBeforeUpdate(deltaTime: number): void {
      cachedCollisionBatch = null;
      (bridge?.getPhysicsBridge() as WasmEnginePhysics2D | undefined)?.physics_step(deltaTime);
    },

    onUpdate(_dt: number): void {
      if (!physicsService) return;
      const batch = physicsService.getCollisionEventsBatch();
      if (batch.count === 0) return;

      if (cfg.eventMode === 'hybrid')
        void currentEngine?.hooks.callHook('physics:collision:batch', batch);

      // Cast to internal type to access slot indices, which are not on the public CollisionEvent.
      const internalEvents = batch.events as unknown as InternalCollisionEvent[];

      for (const event of internalEvents) {
        for (const item of [
          { slot: event.slotA, id: processSensorId(activeSensors, event.slotA, event.aColliderId) },
          { slot: event.slotB, id: processSensorId(activeSensors, event.slotB, event.bColliderId) },
        ]) {
          if (item.id === undefined) continue;
          const generation = bridge!.getEntityGeneration(item.slot);
          if (generation === undefined) continue;
          const entityId = createEntityId(item.slot, generation);
          const prevState = physicsService.getSensorState(entityId, item.id);
          physicsService.updateSensorState(entityId, item.id, event.started);
          const nextState = physicsService.getSensorState(entityId, item.id);
          if (prevState.isActive !== nextState.isActive)
            void currentEngine?.hooks.callHook(
              'physics:sensor:changed',
              entityId,
              item.id,
              nextState,
            );
        }
      }

      const contacts: CollisionContact[] = [];
      for (const ev of internalEvents) {
        const genA = bridge!.getEntityGeneration(ev.slotA);
        const genB = bridge!.getEntityGeneration(ev.slotB);
        if (genA === undefined || genB === undefined) continue;
        contacts.push({
          entityA: createEntityId(ev.slotA, genA),
          entityB: createEntityId(ev.slotB, genB),
          ...(ev.aColliderId !== undefined ? { aColliderId: ev.aColliderId } : {}),
          ...(ev.bColliderId !== undefined ? { bColliderId: ev.bColliderId } : {}),
          started: ev.started,
        });
      }

      void currentEngine?.hooks.callHook('physics:collision', contacts);
      for (const contact of contacts) {
        const slotA = unpackEntityId(contact.entityA).index;
        const slotB = unpackEntityId(contact.entityB).index;
        entityCollisionCallbacks.get(slotA)?.(contact.entityA, contact.entityB, contact);
        entityCollisionCallbacks.get(slotB)?.(contact.entityB, contact.entityA, contact);
      }
    },

    teardown(): void {
      eventsView = null;
      eventsBufferRef = null;
      physicsService = null;
      currentEngine = null;
      entityCollisionCallbacks.clear();
      activeSensors.clear();
      loadedTilemapChunks.clear();
      bridge = null;
    },
  };
});

export const Physics2D = Physics2DPlugin;
export function physics2D(config: Physics2DConfig = {}) {
  return Physics2DPlugin(config);
}

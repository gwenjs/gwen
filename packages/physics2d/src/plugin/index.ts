/// <reference types="vite/client" />

/**
 * @gwenjs/physics2d
 *
 * 2D physics plugin for GWEN — pure adapter providing 2D rigid-body physics via the core WASM.
 */

import { definePlugin } from "@gwenjs/kit/plugin";
import { createLogger } from "@gwenjs/core";
import { getWasmBridge } from "@gwenjs/core/internal";
import type { GwenEngine, EntityId, WasmBridge } from "@gwenjs/core";
import type { WasmEnginePhysics2D } from "@gwenjs/core/internal";

import type {
  Physics2DConfig,
  Physics2DAPI,
  CollisionEventsBatch,
  Physics2DPrefabExtension,
  Physics2DPluginHooks,
  CollisionContact,
} from "../types";

import {
  BODY_TYPE,
  PHYSICS2D_BRIDGE_SCHEMA_VERSION,
  PHYSICS_QUALITY_PRESET_CODE,
  PHYSICS2D_WASM_EVENT_STRIDE,
} from "../types";

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
} from "../config";

import { addPrefabCollider } from "../prefab";
import { Physics2DStaleBodyHandleError, Physics2DStaleEntityError } from "../errors";
import { tilemapChunkIdFromKey, tilemapPseudoEntityFromChunkId } from "../utils";

// Public exports
export {
  createPhysicsKinematicSyncSystem,
  createPlatformerGroundedSystem,
  SENSOR_ID_FOOT,
} from "../systems";
export { buildTilemapPhysicsChunks, patchTilemapPhysicsChunk } from "../helpers/tilemap";
export type {
  PhysicsKinematicSyncSystemOptions,
  PlatformerGroundedSystemOptions,
} from "../systems";

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
} from "../types";

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
  const loadedTilemapChunks = new Map<
    string,
    { chunkId: number; checksum: string; bodyHandle: number }
  >();
  const activeSensors = new Map<number, Set<number>>();
  // Sensor contact counts tracked in JS — key: `${entitySlot}:${colliderId}`
  const sensorContacts = new Map<string, number>();
  const entityCollisionCallbacks = new Map<
    number,
    NonNullable<Physics2DPrefabExtension["onCollision"]>
  >();
  const ownerBySlot = new Map<number, EntityId>();
  const ownerByHandle = new Map<number, EntityId>();
  const handleBySlot = new Map<number, number>();
  const ownerChangedSinceStep = new Set<number>();
  const unhooks: Array<() => void> = [];

  function asEntityId(id: EntityId | number | string): EntityId {
    return (typeof id === "bigint" ? id : BigInt(id)) as EntityId;
  }

  function slotOf(id: EntityId): number {
    return Number(id & 0xffffffffn);
  }

  // Mocks that omit isAlive stay "not dead", so fixture ids keep today's no-body results.
  function entityIsDead(id: EntityId): boolean {
    if (!currentEngine || typeof currentEngine.isAlive !== "function") return false;
    return !currentEngine.isAlive(id);
  }

  function setOwner(slot: number, id: EntityId, handle: number): void {
    const prev = handleBySlot.get(slot);
    if (prev !== undefined && prev !== handle) ownerByHandle.delete(prev);
    ownerBySlot.set(slot, id);
    ownerByHandle.set(handle, id);
    handleBySlot.set(slot, handle);
    ownerChangedSinceStep.add(slot);
  }

  function clearOwner(slot: number): void {
    const handle = handleBySlot.get(slot);
    if (handle !== undefined) ownerByHandle.delete(handle);
    handleBySlot.delete(slot);
    ownerBySlot.delete(slot);
    ownerChangedSinceStep.add(slot);
  }

  function guard(id: EntityId, operation: string): { id: EntityId; slot: number } | null {
    const slot = slotOf(id);
    if (ownerBySlot.get(slot) === id) return { id, slot };
    if (entityIsDead(id)) throw new Physics2DStaleEntityError(id, operation);
    return null;
  }

  function requireHandle(handle: number, operation: "addBoxCollider" | "addBallCollider"): void {
    if (!ownerByHandle.has(handle)) throw new Physics2DStaleBodyHandleError(handle, operation);
  }

  /** Owner record only. Drops a slot with no owner or one changed since the last step. */
  function resolveOwner(slot: number): EntityId | undefined {
    if (ownerChangedSinceStep.has(slot)) return undefined;
    return ownerBySlot.get(slot);
  }

  function resolveContacts(events: ReadonlyArray<InternalCollisionEvent>): CollisionContact[] {
    const out: CollisionContact[] = [];
    for (const ev of events) {
      const entityA = resolveOwner(ev.slotA);
      const entityB = resolveOwner(ev.slotB);
      if (entityA === undefined || entityB === undefined) continue;
      out.push({
        entityA,
        entityB,
        ...(ev.aColliderId !== undefined ? { aColliderId: ev.aColliderId } : {}),
        ...(ev.bColliderId !== undefined ? { bColliderId: ev.bColliderId } : {}),
        started: ev.started,
      });
    }
    return out;
  }

  function track(off: unknown): void {
    unhooks.push(typeof off === "function" ? (off as () => void) : () => {});
  }

  // Physics bridge reference — typed as WasmBridge since getWasmBridge() always returns it.
  let bridge: WasmBridge | null = null;
  let currentEngine: GwenEngine | null = null;
  let physicsService: Physics2DAPI | null = null;
  let log: import("@gwenjs/schema").IGwenLogger = createLogger("@gwenjs/physics2d", cfg.debug);

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
    return {
      isDebugEnabled: () => cfg.debug,
      addRigidBody: (entityId, type, x, y, opts = {}) => {
        const id = asEntityId(entityId);
        if (entityIsDead(id)) throw new Physics2DStaleEntityError(id, "addRigidBody");
        const s = slotOf(id);
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
          log.debug(
            `addRigidBody entity=${s} type=${type} x=${x.toFixed(3)} y=${y.toFixed(3)} -> handle=${handle}`,
          );
        setOwner(s, id, handle);
        return handle;
      },
      addBoxCollider: (handle, hw, hh, opts = {}) => {
        requireHandle(handle, "addBoxCollider");
        pb.physics_add_box_collider(
          handle,
          hw,
          hh,
          opts.restitution ?? 0,
          opts.friction ?? 0.5,
          opts.isSensor ? 1 : 0,
          opts.density ?? 1.0,
          typeof opts.membershipLayers === "number"
            ? opts.membershipLayers
            : layerRegistry.resolve(opts.membershipLayers as string[] | undefined, "membership"),
          typeof opts.filterLayers === "number"
            ? opts.filterLayers
            : layerRegistry.resolve(opts.filterLayers as string[] | undefined, "filter"),
          opts.colliderId,
          opts.offsetX,
          opts.offsetY,
          opts.oneWay ? 1 : 0,
        );
      },
      addBallCollider: (handle, radius, opts = {}) => {
        requireHandle(handle, "addBallCollider");
        pb.physics_add_ball_collider(
          handle,
          radius,
          opts.restitution ?? 0,
          opts.friction ?? 0.5,
          opts.isSensor ? 1 : 0,
          opts.density ?? 1.0,
          typeof opts.membershipLayers === "number"
            ? opts.membershipLayers
            : layerRegistry.resolve(opts.membershipLayers as string[] | undefined, "membership"),
          typeof opts.filterLayers === "number"
            ? opts.filterLayers
            : layerRegistry.resolve(opts.filterLayers as string[] | undefined, "filter"),
          opts.colliderId,
          opts.offsetX,
          opts.offsetY,
        );
      },
      removeBody: (entityId) => {
        const id = asEntityId(entityId);
        const slot = slotOf(id);
        if (ownerBySlot.get(slot) !== id) return;
        pb.physics_remove_rigid_body(slot);
        clearOwner(slot);
      },
      setKinematicPosition: (entityId, x, y) => {
        const owned = guard(asEntityId(entityId), "setKinematicPosition");
        if (!owned) return;
        pb.physics_set_kinematic_position(owned.slot, x, y, 0);
      },
      setKinematicPositionWithAngle: (entityId, x, y, angle) => {
        const owned = guard(asEntityId(entityId), "setKinematicPositionWithAngle");
        if (!owned) return false;
        return pb.physics_set_kinematic_position(owned.slot, x, y, angle) === 1;
      },
      bulkStepKinematics: (slots, vx, vy, dt) => pb.physics_bulk_step_kinematics(slots, vx, vy, dt),
      applyImpulse: (entityId, x, y) => {
        const owned = guard(asEntityId(entityId), "applyImpulse");
        if (!owned) return;
        pb.physics_apply_impulse(owned.slot, x, y);
      },
      setLinearVelocity: (entityId, vx, vy) => {
        const owned = guard(asEntityId(entityId), "setLinearVelocity");
        if (!owned) return;
        pb.physics_set_linear_velocity(owned.slot, vx, vy);
      },
      getLinearVelocity: (entityId) => {
        const owned = guard(asEntityId(entityId), "getLinearVelocity");
        if (!owned) return null;
        const res = pb.physics_get_linear_velocity(owned.slot);
        return res ? { x: res[0], y: res[1] } : null;
      },
      getPosition: (entityId) => {
        const owned = guard(asEntityId(entityId), "getPosition");
        if (!owned) return null;
        const res = pb.physics_get_position(owned.slot);
        if (!res || res.length === 0) return null;
        return { x: res[0], y: res[1], rotation: res[2] };
      },
      getSensorState: (entityId, colliderId) => {
        const owned = guard(asEntityId(entityId), "getSensorState");
        if (!owned) return { contactCount: 0, isActive: false };
        const key = `${owned.slot}:${colliderId}`;
        const count = sensorContacts.get(key) ?? 0;
        return { contactCount: count, isActive: count > 0 };
      },
      updateSensorState: (entityId, colliderId, active) => {
        const owned = guard(asEntityId(entityId), "updateSensorState");
        if (!owned) return;
        const key = `${owned.slot}:${colliderId}`;
        const current = sensorContacts.get(key) ?? 0;
        const next = active ? current + 1 : Math.max(0, current - 1);
        if (next === 0) sensorContacts.delete(key);
        else sensorContacts.set(key, next);
      },
      getCollisionEventsBatch: (opts) => readCollisionEvents(opts?.max),
      getCollisionContacts: (opts) => {
        const batch = readCollisionEvents(opts?.max);
        return resolveContacts(batch.events as unknown as InternalCollisionEvent[]);
      },
      /**
       * Update the linear damping coefficient of a dynamic body at runtime.
       * @param entityId - The entity whose body to update.
       * @param damping  - New damping value ≥ 0. 0 = no damping.
       */
      setLinearDamping: (entityId, damping) => {
        const owned = guard(asEntityId(entityId), "setLinearDamping");
        if (!owned) return;
        pb.physics_set_linear_damping?.(owned.slot, damping);
      },

      /**
       * Return all entities whose colliders intersect a circle.
       * @param x      - World-space centre X in metres.
       * @param y      - World-space centre Y in metres.
       * @param radius - Radius in metres.
       * @param opts   - Optional layer filter.
       */
      queryRadius: (x, y, radius, opts) => {
        const membership =
          typeof opts?.membershipLayers === "number"
            ? opts.membershipLayers
            : layerRegistry.resolve(opts?.membershipLayers as string[] | undefined, "membership");
        const filter =
          typeof opts?.filterLayers === "number"
            ? opts.filterLayers
            : layerRegistry.resolve(opts?.filterLayers as string[] | undefined, "filter");
        return Array.from(
          pb.physics_query_radius?.(x, y, radius, membership, filter) ?? [],
        ).flatMap((s) => {
          const id = resolveOwner(s);
          return id !== undefined ? [id] : [];
        });
      },

      /**
       * Return all entities whose colliders intersect an axis-aligned rectangle.
       * @param x  - World-space centre X in metres.
       * @param y  - World-space centre Y in metres.
       * @param hw - Half-width in metres.
       * @param hh - Half-height in metres.
       * @param opts - Optional layer filter.
       */
      queryRect: (x, y, hw, hh, opts) => {
        const membership =
          typeof opts?.membershipLayers === "number"
            ? opts.membershipLayers
            : layerRegistry.resolve(opts?.membershipLayers as string[] | undefined, "membership");
        const filter =
          typeof opts?.filterLayers === "number"
            ? opts.filterLayers
            : layerRegistry.resolve(opts?.filterLayers as string[] | undefined, "filter");
        return Array.from(pb.physics_query_rect?.(x, y, hw, hh, membership, filter) ?? []).flatMap(
          (s) => {
            const id = resolveOwner(s);
            return id !== undefined ? [id] : [];
          },
        );
      },

      /**
       * Return all entities whose colliders contain the given point.
       * @param x    - World-space X in metres.
       * @param y    - World-space Y in metres.
       * @param opts - Optional layer filter.
       */
      pointQuery: (x, y, opts) => {
        const membership =
          typeof opts?.membershipLayers === "number"
            ? opts.membershipLayers
            : layerRegistry.resolve(opts?.membershipLayers as string[] | undefined, "membership");
        const filter =
          typeof opts?.filterLayers === "number"
            ? opts.filterLayers
            : layerRegistry.resolve(opts?.filterLayers as string[] | undefined, "filter");
        return Array.from(pb.physics_point_query?.(x, y, membership, filter) ?? []).flatMap((s) => {
          const id = resolveOwner(s);
          return id !== undefined ? [id] : [];
        });
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
          ownerByHandle.delete(existing.bodyHandle);
          pb.physics_unload_tilemap_chunk_body(existing.chunkId);
          loadedTilemapChunks.delete(chunk.key);
        }
        const chunkId = tilemapChunkIdFromKey(chunk.key);
        const pseudoEntityIndex = tilemapPseudoEntityFromChunkId(chunkId);
        const bodyHandle = pb.physics_load_tilemap_chunk_body(chunkId, pseudoEntityIndex, x, y);
        ownerByHandle.set(bodyHandle, asEntityId(pseudoEntityIndex));
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
        loadedTilemapChunks.set(chunk.key, { chunkId, checksum: chunk.checksum, bodyHandle });
      },
      unloadTilemapPhysicsChunk(key) {
        const loaded = loadedTilemapChunks.get(key);
        if (!loaded) return;
        ownerByHandle.delete(loaded.bodyHandle);
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
    name: "@gwenjs/physics2d",
    provides: { physics: {} as Physics2DAPI },
    providesHooks: {} as Physics2DPluginHooks,
    extensions: { prefab: {} as Physics2DPrefabExtension },

    // ── Lifecycle ──────────────────────────────────────────────────────

    setup(engine: GwenEngine): void {
      log = engine.logger?.child("@gwenjs/physics2d") ?? log;
      bridge = getWasmBridge();

      if (!bridge.hasPhysics()) {
        throw new Error("[Physics2D] Core WASM variant does not include physics.");
      }

      currentEngine = engine;
      const pb = bridge.getPhysicsBridge() as WasmEnginePhysics2D;
      pb.physics_init(cfg.gravityX, cfg.gravity, cfg.maxEntities);
      pb.physics_set_quality(PHYSICS_QUALITY_PRESET_CODE[cfg.qualityPreset]);
      pb.physics_set_event_coalescing(cfg.coalesceEvents ? 1 : 0);
      pb.physics_set_global_ccd_enabled(resolveGlobalCcdEnabled(cfg) ? 1 : 0);

      physicsService = createAPI();
      engine.provide("physics2d", physicsService!);

      track(
        engine.hooks.hook("prefab:instantiate", (entityId, extensions) => {
          const ext = extensions?.physics;
          if (!ext) return;

          const slot = slotOf(asEntityId(entityId));

          const handle = physicsService!.addRigidBody(entityId, ext.bodyType ?? "dynamic", 0, 0, {
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
              "[Physics2D] Prefab extension must declare `extensions.physics.colliders[]` in v2.",
            );
          }

          if (ext.onCollision) entityCollisionCallbacks.set(slot, ext.onCollision);
        }),
      );

      track(
        engine.hooks.hook("entity:destroy", (entityId: EntityId) => {
          const id = asEntityId(entityId);
          const slot = slotOf(id);
          if (ownerBySlot.get(slot) !== id) return;
          entityCollisionCallbacks.delete(slot);
          activeSensors.delete(slot);
          const prefix = `${slot}:`;
          for (const key of [...sensorContacts.keys()]) {
            if (key.startsWith(prefix)) sensorContacts.delete(key);
          }
          physicsService?.removeBody(id);
        }),
      );

      track(
        engine.hooks.hook("engine:before-update", (deltaTime: number) => {
          cachedCollisionBatch = null;
          (bridge?.getPhysicsBridge() as WasmEnginePhysics2D | undefined)?.physics_step(deltaTime);
          ownerChangedSinceStep.clear();
        }),
      );

      track(
        engine.hooks.hook("engine:update", (_dt: number) => {
          if (!physicsService) return;
          const batch = physicsService.getCollisionEventsBatch();
          if (batch.count === 0) return;

          if (cfg.eventMode === "hybrid")
            void currentEngine?.hooks.callHook("physics:collision:batch", batch);

          // Cast to internal type to access slot indices, which are not on the public CollisionEvent.
          const internalEvents = batch.events as unknown as InternalCollisionEvent[];

          for (const event of internalEvents) {
            for (const item of [
              {
                slot: event.slotA,
                id: processSensorId(activeSensors, event.slotA, event.aColliderId),
              },
              {
                slot: event.slotB,
                id: processSensorId(activeSensors, event.slotB, event.bColliderId),
              },
            ]) {
              if (item.id === undefined) continue;
              const entityId = resolveOwner(item.slot);
              if (entityId === undefined) continue;
              const prevState = physicsService.getSensorState(entityId, item.id);
              physicsService.updateSensorState(entityId, item.id, event.started);
              const nextState = physicsService.getSensorState(entityId, item.id);
              if (prevState.isActive !== nextState.isActive)
                void currentEngine?.hooks.callHook(
                  "physics:sensor:changed",
                  entityId,
                  item.id,
                  nextState,
                );
            }
          }

          const contacts = resolveContacts(internalEvents);

          void currentEngine?.hooks.callHook("physics:collision", contacts);
          for (const contact of contacts) {
            const slotA = slotOf(contact.entityA);
            const slotB = slotOf(contact.entityB);
            entityCollisionCallbacks.get(slotA)?.(contact.entityA, contact.entityB, contact);
            entityCollisionCallbacks.get(slotB)?.(contact.entityB, contact.entityA, contact);
          }
        }),
      );
    },

    teardown(): void {
      for (const off of unhooks) off();
      unhooks.length = 0;
      eventsView = null;
      eventsBufferRef = null;
      physicsService = null;
      currentEngine = null;
      entityCollisionCallbacks.clear();
      activeSensors.clear();
      sensorContacts.clear();
      ownerBySlot.clear();
      ownerByHandle.clear();
      handleBySlot.clear();
      ownerChangedSinceStep.clear();
      loadedTilemapChunks.clear();
      bridge = null;
    },
  };
});

export const Physics2D = Physics2DPlugin;
export function physics2D(config: Physics2DConfig = {}) {
  return Physics2DPlugin(config);
}

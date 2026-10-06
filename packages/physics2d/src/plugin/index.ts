/**
 * @gwenjs/physics2d
 *
 * 2D physics plugin for GWEN — pure adapter providing 2D rigid-body physics via the core WASM.
 */

import { definePlugin } from "@gwenjs/kit/plugin";
import { createLogger, createEntityId, createEngineLocal, useEngine } from "@gwenjs/core";
import {
  engineContext,
  entityIndex,
  getWasmBridge,
  reportRejectedHook,
} from "@gwenjs/core/internal";
import type { GwenEngine, EntityId, IGwenLogger, MemoryView, WasmBridge } from "@gwenjs/core";
import type { WasmEnginePhysics2D } from "@gwenjs/core/internal";
import { GwenError } from "@gwenjs/schema";

import type {
  Physics2DConfig,
  Physics2DAPI,
  Physics2DPrefabExtension,
  Physics2DPluginHooks,
  CollisionContact,
  InternalCollisionEvent,
  InternalCollisionEventsBatch,
} from "../types";

import {
  BODY_TYPE,
  PHYSICS2D_BRIDGE_SCHEMA_VERSION,
  PHYSICS_QUALITY_PRESET_CODE,
  PHYSICS2D_WASM_EVENT_STRIDE,
} from "../types";

import {
  normalizeConfig,
  LayerRegistry,
  resolveGlobalCcdEnabled,
  PIXELS_PER_METER,
} from "../config";

import { addPrefabCollider } from "../prefab";
import {
  Physics2DErrorCodes,
  Physics2DStaleBodyHandleError,
  Physics2DStaleEntityError,
} from "../errors";
import { tilemapChunkIdFromKey, tilemapPseudoEntityFromChunkId } from "../utils";
import {
  _clearContactCallbacks,
  _dispatchContactEvent,
  clearEngineContacts,
} from "../composables/on-contact";
import {
  _clearSensorCallbacks,
  _dispatchSensorEnter,
  _dispatchSensorExit,
  clearEngineSensors,
} from "../composables/on-sensor";
import type { ContactEvent } from "../types";

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
  InternalCollisionEventsBatch,
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

  // p59-state-start
  interface P2State {
    loadedTilemapChunks: Map<string, { chunkId: number; checksum: string; bodyHandle: number }>;
    activeSensors: Map<number, Set<number>>;
    sensorContacts: Map<string, number>;
    entityCollisionCallbacks: Map<number, NonNullable<Physics2DPrefabExtension["onCollision"]>>;
    ownerBySlot: Map<number, EntityId>;
    ownerByHandle: Map<number, EntityId>;
    handleBySlot: Map<number, number>;
    ownerChangedSinceStep: Set<number>;
    unhooks: Array<() => void>;
    bridge: WasmBridge | null;
    currentEngine: GwenEngine | null;
    physicsService: Physics2DAPI | null;
    log: IGwenLogger;
    collisionEvents: MemoryView<"dataview"> | null;
    pooledCollisionEvents: InternalCollisionEvent[];
    cachedCollisionBatch: InternalCollisionEventsBatch | null;
  }

  const p2States = createEngineLocal<P2State>(() => ({
    loadedTilemapChunks: new Map(),
    activeSensors: new Map(),
    sensorContacts: new Map(),
    entityCollisionCallbacks: new Map(),
    ownerBySlot: new Map(),
    ownerByHandle: new Map(),
    handleBySlot: new Map(),
    ownerChangedSinceStep: new Set(),
    unhooks: [],
    bridge: null,
    currentEngine: null,
    physicsService: null,
    log: createLogger("@gwenjs/physics2d", cfg.debug),
    collisionEvents: null,
    pooledCollisionEvents: [],
    cachedCollisionBatch: null,
  }));

  const st = new Proxy({} as P2State, {
    get(_target, prop) {
      return Reflect.get(p2States.use(), prop);
    },
    set(_target, prop, value) {
      return Reflect.set(p2States.use(), prop, value);
    },
  });

  /** Service calls keep this engine current, even when the caller is outside `run`. */
  function bindToEngine<T extends object>(engine: GwenEngine, api: T): T {
    return new Proxy(api, {
      get(target, prop, receiver) {
        const value: unknown = Reflect.get(target, prop, receiver);
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          const previous = engineContext.tryUse() ?? undefined;
          engineContext.set(engine, true);
          try {
            return Reflect.apply(value, target, args);
          } finally {
            if (engineContext.tryUse() === engine) {
              if (previous !== undefined) engineContext.set(previous, true);
              else engineContext.unset();
            }
          }
        };
      },
    });
  }
  // p59-state-end

  function entityIsDead(id: EntityId): boolean {
    return st.currentEngine !== null && !st.currentEngine.isAlive(id);
  }

  function setOwner(slot: number, id: EntityId, handle: number): void {
    const prev = st.handleBySlot.get(slot);
    if (prev !== undefined && prev !== handle) st.ownerByHandle.delete(prev);
    st.ownerBySlot.set(slot, id);
    st.ownerByHandle.set(handle, id);
    st.handleBySlot.set(slot, handle);
    st.ownerChangedSinceStep.add(slot);
  }

  function clearOwner(slot: number): void {
    const handle = st.handleBySlot.get(slot);
    if (handle !== undefined) st.ownerByHandle.delete(handle);
    st.handleBySlot.delete(slot);
    st.ownerBySlot.delete(slot);
    st.ownerChangedSinceStep.add(slot);
  }

  function guard(id: EntityId, operation: string): { id: EntityId; slot: number } | null {
    const slot = entityIndex(id);
    if (st.ownerBySlot.get(slot) === id) return { id, slot };
    if (entityIsDead(id)) throw new Physics2DStaleEntityError(id, operation);
    return null;
  }

  function requireHandle(handle: number, operation: "addBoxCollider" | "addBallCollider"): void {
    if (!st.ownerByHandle.has(handle)) throw new Physics2DStaleBodyHandleError(handle, operation);
  }

  /** Owner record only. Drops a slot with no owner or one changed since the last step. */
  function resolveOwner(slot: number): EntityId | undefined {
    if (st.ownerChangedSinceStep.has(slot)) return undefined;
    return st.ownerBySlot.get(slot);
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
    st.unhooks.push(typeof off === "function" ? (off as () => void) : () => {});
  }

  /**
   * Reads pending collision events from the static WASM buffer.
   */
  function readCollisionEvents(max?: number): InternalCollisionEventsBatch {
    if (st.cachedCollisionBatch && max === undefined) {
      return st.cachedCollisionBatch;
    }

    const pb = st.bridge!.getPhysicsBridge() as WasmEnginePhysics2D;
    const memory = st.bridge!.getLinearMemory();
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
    const count = pb.physics_get_collision_event_count();
    const visibleCount = max !== undefined && max >= 0 ? Math.min(max, count) : count;
    const length = (): number => {
      const live = st.bridge!.getLinearMemory();
      if (live === null) return 0;
      const bytes = live.buffer.byteLength - pb.physics_get_collision_events_ptr();
      const cap = MAX_EVENTS * EVENT_STRIDE;
      if (bytes <= 0) return 0;
      return bytes > cap ? cap : bytes;
    };
    let eventsView: DataView | null = null;
    if (visibleCount > 0) {
      if (st.collisionEvents === null && st.currentEngine !== null) {
        st.collisionEvents = st.currentEngine.memory.view({
          name: "physics2d:collision-events",
          type: "dataview",
          ptr: () => pb.physics_get_collision_events_ptr(),
          length,
        });
      }
      if (st.collisionEvents === null || length() <= 0) {
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
      eventsView = st.collisionEvents.array;
    }

    st.pooledCollisionEvents.length = visibleCount;
    for (let i = 0; i < visibleCount; i++) {
      const offset = i * EVENT_STRIDE;
      const type = eventsView!.getUint32(offset + 8, true);

      let ev = st.pooledCollisionEvents[i];
      if (!ev) {
        ev = { slotA: 0, slotB: 0, started: false } satisfies InternalCollisionEvent;
        st.pooledCollisionEvents[i] = ev;
      }

      ev.slotA = eventsView!.getUint32(offset, true);
      ev.slotB = eventsView!.getUint32(offset + 4, true);
      ev.started = type === 0 || type === 2;

      const aId = eventsView!.getUint16(offset + 12, true);
      const bId = eventsView!.getUint16(offset + 14, true);
      if (aId === 0xffff) delete ev.aColliderId;
      else ev.aColliderId = aId;
      if (bId === 0xffff) delete ev.bColliderId;
      else ev.bColliderId = bId;
    }

    const metrics = pb.physics_consume_event_metrics
      ? pb.physics_consume_event_metrics()
      : [0, 0, 0, 0];
    const batch: InternalCollisionEventsBatch = {
      frame: metrics[0] ?? 0,
      count: visibleCount,
      droppedSinceLastRead: (metrics[1] ?? 0) + (metrics[2] ?? 0),
      droppedCritical: metrics[1] ?? 0,
      droppedNonCritical: metrics[2] ?? 0,
      coalesced: metrics[3] === 1,
      events: st.pooledCollisionEvents,
    };

    if (max === undefined) st.cachedCollisionBatch = batch;
    return batch;
  }

  /** Build the public Physics2DAPI using the currently-active st.bridge (set in setup). */
  function createAPI(): Physics2DAPI {
    const pb = st.bridge!.getPhysicsBridge() as WasmEnginePhysics2D;
    return {
      isDebugEnabled: () => cfg.debug,
      addRigidBody: (entityId, type, x, y, opts = {}) => {
        if (entityIsDead(entityId)) throw new Physics2DStaleEntityError(entityId, "addRigidBody");
        const s = entityIndex(entityId);
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
          st.log.debug(
            `addRigidBody entity=${s} type=${type} x=${x.toFixed(3)} y=${y.toFixed(3)} -> handle=${handle}`,
          );
        setOwner(s, entityId, handle);
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
        const slot = entityIndex(entityId);
        if (st.ownerBySlot.get(slot) !== entityId) return;
        pb.physics_remove_rigid_body(slot);
        clearOwner(slot);
      },
      setKinematicPosition: (entityId, x, y) => {
        const owned = guard(entityId, "setKinematicPosition");
        if (!owned) return;
        pb.physics_set_kinematic_position(owned.slot, x, y, 0);
      },
      setKinematicPositionWithAngle: (entityId, x, y, angle) => {
        const owned = guard(entityId, "setKinematicPositionWithAngle");
        if (!owned) return false;
        return pb.physics_set_kinematic_position(owned.slot, x, y, angle) === 1;
      },
      bulkStepKinematics: (slots, vx, vy, dt) => pb.physics_bulk_step_kinematics(slots, vx, vy, dt),
      applyImpulse: (entityId, x, y) => {
        const owned = guard(entityId, "applyImpulse");
        if (!owned) return;
        pb.physics_apply_impulse(owned.slot, x, y);
      },
      setLinearVelocity: (entityId, vx, vy) => {
        const owned = guard(entityId, "setLinearVelocity");
        if (!owned) return;
        pb.physics_set_linear_velocity(owned.slot, vx, vy);
      },
      getLinearVelocity: (entityId) => {
        const owned = guard(entityId, "getLinearVelocity");
        if (!owned) return null;
        const res = pb.physics_get_linear_velocity(owned.slot);
        if (!res || res.length < 2) return null;
        return { x: res[0]!, y: res[1]! };
      },
      getPosition: (entityId) => {
        const owned = guard(entityId, "getPosition");
        if (!owned) return null;
        const res = pb.physics_get_position(owned.slot);
        if (!res || res.length < 3) return null;
        return { x: res[0]!, y: res[1]!, rotation: res[2]! };
      },
      getSensorState: (entityId, colliderId) => {
        const owned = guard(entityId, "getSensorState");
        if (!owned) return { contactCount: 0, isActive: false };
        const key = `${owned.slot}:${colliderId}`;
        const count = st.sensorContacts.get(key) ?? 0;
        return { contactCount: count, isActive: count > 0 };
      },
      updateSensorState: (entityId, colliderId, active) => {
        const owned = guard(entityId, "updateSensorState");
        if (!owned) return;
        const key = `${owned.slot}:${colliderId}`;
        const current = st.sensorContacts.get(key) ?? 0;
        const next = active ? current + 1 : Math.max(0, current - 1);
        if (next === 0) st.sensorContacts.delete(key);
        else st.sensorContacts.set(key, next);
      },
      getCollisionEventsBatch: (opts) => readCollisionEvents(opts?.max),
      getCollisionContacts: (opts) => {
        const batch = readCollisionEvents(opts?.max);
        return resolveContacts(batch.events);
      },
      /**
       * Update the linear damping coefficient of a dynamic body at runtime.
       * @param entityId - The entity whose body to update.
       * @param damping  - New damping value ≥ 0. 0 = no damping.
       */
      setLinearDamping: (entityId, damping) => {
        const owned = guard(entityId, "setLinearDamping");
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
        const memory = st.bridge!.getLinearMemory();
        if (!memory) return [];
        const view = new Float32Array(memory.buffer, ptr, count * 2);
        const path: Array<{ x: number; y: number }> = [];
        for (let i = 0; i < count; i++) {
          path.push({ x: view[i * 2] ?? 0, y: view[i * 2 + 1] ?? 0 });
        }
        return path;
      },
      loadTilemapPhysicsChunk(chunk, x, y, opts = {}) {
        const existing = st.loadedTilemapChunks.get(chunk.key);
        if (existing?.checksum === chunk.checksum) return;
        if (existing) {
          st.ownerByHandle.delete(existing.bodyHandle);
          pb.physics_unload_tilemap_chunk_body(existing.chunkId);
          st.loadedTilemapChunks.delete(chunk.key);
        }
        const chunkId = tilemapChunkIdFromKey(chunk.key);
        const pseudoEntityIndex = tilemapPseudoEntityFromChunkId(chunkId);
        const bodyHandle = pb.physics_load_tilemap_chunk_body(chunkId, pseudoEntityIndex, x, y);
        st.ownerByHandle.set(bodyHandle, createEntityId(pseudoEntityIndex, 0));
        if (!opts.debugNaive) {
          for (const [colliderIndex, collider] of chunk.colliders.entries())
            addPrefabCollider(
              st.physicsService!,
              bodyHandle,
              collider,
              layerRegistry,
              colliderIndex,
              0.5,
            );
        }
        st.loadedTilemapChunks.set(chunk.key, { chunkId, checksum: chunk.checksum, bodyHandle });
      },
      unloadTilemapPhysicsChunk(key) {
        const loaded = st.loadedTilemapChunks.get(key);
        if (!loaded) return;
        st.ownerByHandle.delete(loaded.bodyHandle);
        pb.physics_unload_tilemap_chunk_body(loaded.chunkId);
        st.loadedTilemapChunks.delete(key);
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
      st.log = engine.logger?.child("@gwenjs/physics2d") ?? st.log;
      st.bridge = getWasmBridge();

      if (!st.bridge.hasPhysics()) {
        throw new GwenError(
          Physics2DErrorCodes.WASM_VARIANT_MISMATCH,
          "[Physics2D] Core WASM variant does not include physics.",
        );
      }

      st.currentEngine = useEngine();
      const pb = st.bridge.getPhysicsBridge() as WasmEnginePhysics2D;
      pb.physics_init(cfg.gravityX, cfg.gravity, cfg.maxEntities);
      pb.physics_set_quality(PHYSICS_QUALITY_PRESET_CODE[cfg.qualityPreset]);
      pb.physics_set_event_coalescing(cfg.coalesceEvents ? 1 : 0);
      pb.physics_set_global_ccd_enabled(resolveGlobalCcdEnabled(cfg) ? 1 : 0);

      const api = bindToEngine(useEngine(), createAPI());
      st.physicsService = api;
      engine.provide("physics2d", api);

      track(
        engine.hooks.hook("prefab:instantiate", (entityId, extensions) => {
          const ext = extensions?.physics;
          if (!ext) return;

          const slot = entityIndex(entityId);

          const handle = st.physicsService!.addRigidBody(
            entityId,
            ext.bodyType ?? "dynamic",
            0,
            0,
            {
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
            },
          );

          if (Array.isArray(ext.colliders)) {
            const sensors = new Set<number>();
            for (const [idx, collider] of ext.colliders.entries()) {
              const colliderId = collider.colliderId ?? idx;
              addPrefabCollider(st.physicsService!, handle, collider, layerRegistry, colliderId, 0);
              if (collider.isSensor) sensors.add(colliderId);
            }
            if (sensors.size > 0) st.activeSensors.set(slot, sensors);
          } else {
            throw new GwenError(
              Physics2DErrorCodes.INVALID_PREFAB_EXTENSION,
              "[Physics2D] Prefab extension must declare `extensions.physics.colliders[]` in v2.",
            );
          }

          if (ext.onCollision) st.entityCollisionCallbacks.set(slot, ext.onCollision);
        }),
      );

      track(
        engine.hooks.hook("entity:destroy", (entityId: EntityId) => {
          const slot = entityIndex(entityId);
          const owner = st.ownerBySlot.get(slot);
          // Another live id already owns the slot. Leave its callbacks and body alone.
          if (owner !== undefined && owner !== entityId) return;
          _clearContactCallbacks(entityId);
          const dyingSensors = st.activeSensors.get(slot);
          if (dyingSensors) {
            for (const sensorId of dyingSensors) _clearSensorCallbacks(sensorId);
          }
          st.entityCollisionCallbacks.delete(slot);
          st.activeSensors.delete(slot);
          const prefix = `${slot}:`;
          for (const key of st.sensorContacts.keys()) {
            if (key.startsWith(prefix)) st.sensorContacts.delete(key);
          }
          if (owner === entityId) st.physicsService?.removeBody(entityId);
        }),
      );

      track(
        engine.hooks.hook("engine:before-update", (deltaTime: number) => {
          st.cachedCollisionBatch = null;
          (st.bridge?.getPhysicsBridge() as WasmEnginePhysics2D | undefined)?.physics_step(
            deltaTime,
          );
          st.ownerChangedSinceStep.clear();
        }),
      );

      track(
        engine.hooks.hook("engine:update", (_dt: number) => {
          if (!st.physicsService) return;
          const batch = readCollisionEvents();
          if (batch.count === 0) return;

          if (cfg.eventMode === "hybrid")
            reportRejectedHook(
              st.currentEngine,
              "@gwenjs/physics2d",
              "physics:collision:batch",
              st.currentEngine?.hooks.callHook("physics:collision:batch", batch),
            );

          const internalEvents = batch.events;

          for (const event of internalEvents) {
            for (const item of [
              {
                slot: event.slotA,
                id: processSensorId(st.activeSensors, event.slotA, event.aColliderId),
              },
              {
                slot: event.slotB,
                id: processSensorId(st.activeSensors, event.slotB, event.bColliderId),
              },
            ]) {
              if (item.id === undefined) continue;
              const entityId = resolveOwner(item.slot);
              if (entityId === undefined) continue;
              const prevState = st.physicsService.getSensorState(entityId, item.id);
              st.physicsService.updateSensorState(entityId, item.id, event.started);
              const nextState = st.physicsService.getSensorState(entityId, item.id);
              if (prevState.isActive !== nextState.isActive) {
                if (nextState.isActive) _dispatchSensorEnter(item.id, entityId);
                else _dispatchSensorExit(item.id, entityId);
                reportRejectedHook(
                  st.currentEngine,
                  "@gwenjs/physics2d",
                  "physics:sensor:changed",
                  st.currentEngine?.hooks.callHook(
                    "physics:sensor:changed",
                    entityId,
                    item.id,
                    nextState,
                  ),
                );
              }
            }
          }

          const contacts = resolveContacts(internalEvents);

          reportRejectedHook(
            st.currentEngine,
            "@gwenjs/physics2d",
            "physics:collision",
            st.currentEngine?.hooks.callHook("physics:collision", contacts),
          );
          for (const contact of contacts) {
            const slotA = entityIndex(contact.entityA);
            const slotB = entityIndex(contact.entityB);
            const event: ContactEvent = {
              entityA: contact.entityA,
              entityB: contact.entityB,
              contactX: 0,
              contactY: 0,
              normalX: 0,
              normalY: 0,
              relativeVelocity: 0,
            };
            _dispatchContactEvent(contact.entityA, event);
            _dispatchContactEvent(contact.entityB, event);
            st.entityCollisionCallbacks.get(slotA)?.(contact.entityA, contact.entityB, contact);
            st.entityCollisionCallbacks.get(slotB)?.(contact.entityB, contact.entityA, contact);
          }
        }),
      );
    },

    teardown(): void {
      const engine = useEngine();
      clearEngineContacts(engine);
      clearEngineSensors(engine);
      for (const off of st.unhooks) off();
      st.unhooks.length = 0;
      st.collisionEvents?.dispose();
      st.collisionEvents = null;
      st.physicsService = null;
      st.currentEngine = null;
      st.entityCollisionCallbacks.clear();
      st.activeSensors.clear();
      st.sensorContacts.clear();
      st.ownerBySlot.clear();
      st.ownerByHandle.clear();
      st.handleBySlot.clear();
      st.ownerChangedSinceStep.clear();
      st.loadedTilemapChunks.clear();
      st.bridge = null;
    },
  };
});

export const Physics2D = Physics2DPlugin;
export function physics2D(config: Physics2DConfig = {}) {
  return Physics2DPlugin(config);
}

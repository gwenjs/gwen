import { definePlugin } from "@gwenjs/kit/plugin";
import { getWasmBridge, reportRejectedHook } from "@gwenjs/core/internal";
import type { EntityId, GwenEngine } from "@gwenjs/core";

import type {
  Physics3DAPI,
  Physics3DConfig,
  Physics3DCollisionContact,
  Physics3DPrefabExtension,
  Physics3DSensorState,
  Physics3DEntityId,
} from "../types";

import { normalizePhysics3DConfig, buildLayerRegistry, QUALITY_PRESETS } from "../config";

import { _dispatchContactEvent, _clearContactCallbacks } from "../composables/on-contact";
import {
  _dispatchSensorEnter,
  _dispatchSensorExit,
  _clearSensorCallbacks,
} from "../composables/on-sensor";

import type { Physics3DBridgeRuntime } from "./bridge";
import { clearOwnerChanges, entitySlot, guardOwned, ownerEntityId } from "./entity-owner";
import { createPluginContext } from "./plugin-context";

// ─── Sub-module imports ────────────────────────────────────────────────────────

import {
  createBody,
  removeBody,
  hasBody,
  advanceLocalState,
  getBodyKind,
  setBodyKind,
  getBodyState,
  setBodyState,
  createApplyImpulse,
  createApplyAngularImpulse,
  createApplyTorque,
  createGetLinearVelocity,
  createSetLinearVelocity,
  createGetAngularVelocity,
  createSetAngularVelocity,
  createSetKinematicPosition,
} from "./body-management";

import {
  addColliderImpl,
  createAddCollider,
  createRemoveCollider,
  createRebuildMeshCollider,
  createBulkSpawnStaticBoxes,
  createAddCompoundCollider,
} from "./collider-management";

import { createGetSensorState, createUpdateSensorState } from "./sensor-management";

import { detectLocalCollisions, readWasmCollisionEvents } from "./collision-events";

import { createJointMethods } from "./joint-management";

import { createForcesAndConstraints } from "./forces-and-constraints";

import { createCharacterControllerMethods } from "./character-controller";

import { createSpatialQueryMethods } from "./spatial-queries";

import { createPathfindingMethods } from "./pathfinding-service";
import { GwenError } from "@gwenjs/schema";
import { Physics3DErrorCodes } from "../errors/codes";

// ─── Plugin implementation ──────────────────────────────────────────────────────

/**
 * GWEN plugin providing 3D rigid-body physics via Rapier3D integrated in the
 * core WASM. Falls back to a deterministic TypeScript simulation when the WASM
 * physics3d variant is not loaded (e.g. during tests).
 */
export const Physics3DPlugin = definePlugin((config: Physics3DConfig = {}) => {
  const cfg = normalizePhysics3DConfig(config);
  const layerRegistry = buildLayerRegistry(cfg.layers);
  const ctx = createPluginContext(cfg, layerRegistry);

  // ─── Build bound API methods from sub-modules ──────────────────────────────

  const _createBody = (entityId: Physics3DEntityId, options = {}) =>
    createBody(ctx, entityId, options, (eid, opts) => addColliderImpl(ctx, eid, opts));

  const _removeBody = (entityId: Physics3DEntityId) => removeBody(ctx, entityId);
  const _hasBody = (entityId: Physics3DEntityId) => hasBody(ctx, entityId);

  const _getBodyKind = getBodyKind(ctx);
  const _setBodyKind = setBodyKind(ctx);
  const _getBodyState = getBodyState(ctx);
  const _setBodyState = setBodyState(ctx);
  const _applyImpulse = createApplyImpulse(ctx);
  const _applyAngularImpulse = createApplyAngularImpulse(ctx);
  const _applyTorque = createApplyTorque(ctx);
  const _getLinearVelocity = createGetLinearVelocity(ctx);
  const _setLinearVelocity = createSetLinearVelocity(ctx);
  const _getAngularVelocity = createGetAngularVelocity(ctx);
  const _setAngularVelocity = createSetAngularVelocity(ctx);
  const _setKinematicPosition = createSetKinematicPosition(ctx);

  const _addCollider = createAddCollider(ctx);
  const _removeCollider = createRemoveCollider(ctx);
  const _rebuildMeshCollider = createRebuildMeshCollider(ctx);
  const _bulkSpawnStaticBoxes = createBulkSpawnStaticBoxes(ctx);
  const _addCompoundCollider = createAddCompoundCollider(ctx);

  const _getSensorState = createGetSensorState(ctx);
  const _updateSensorState = createUpdateSensorState(ctx);

  const jointMethods = createJointMethods(ctx);
  const forceMethods = createForcesAndConstraints(ctx);
  const ccMethods = createCharacterControllerMethods(ctx);
  const spatialMethods = createSpatialQueryMethods(ctx);
  const pathMethods = createPathfindingMethods(ctx);

  // ─── Service object ───────────────────────────────────────────────────────

  const service: Physics3DAPI = {
    isReady: () => ctx.ready,
    variant: () => ctx._variant,

    step: (deltaSeconds: number) => {
      if (!ctx.stepFn) {
        throw new GwenError(
          Physics3DErrorCodes.NOT_INITIALIZED,
          "[GWEN:Physics3D] step() called before plugin initialization.",
        );
      }
      ctx.stepFn(deltaSeconds);
      if (deltaSeconds > 0 && ctx.backendMode === "local") {
        advanceLocalState(ctx, deltaSeconds);
      }
      clearOwnerChanges(ctx);
    },

    createBody: _createBody,
    removeBody: _removeBody,
    hasBody: _hasBody,
    getBodyKind: _getBodyKind,
    setBodyKind: _setBodyKind,
    getBodyState: _getBodyState,
    setBodyState: _setBodyState,
    applyImpulse: _applyImpulse,
    applyAngularImpulse: _applyAngularImpulse,
    applyTorque: _applyTorque,
    getLinearVelocity: _getLinearVelocity,
    setLinearVelocity: _setLinearVelocity,
    getAngularVelocity: _getAngularVelocity,
    setAngularVelocity: _setAngularVelocity,
    setKinematicPosition: _setKinematicPosition,
    bulkStepKinematics: (slots, vx, vy, vz, dt) => {
      return ctx.wasmBridge?.physics3d_bulk_step_kinematics?.(slots, vx, vy, vz, dt) ?? 0;
    },
    bulkStepKinematicRotations: (slots, wx, wy, wz, dt) => {
      return ctx.wasmBridge?.physics3d_bulk_step_kinematic_rotations?.(slots, wx, wy, wz, dt) ?? 0;
    },
    addCollider: _addCollider,
    removeCollider: _removeCollider,
    rebuildMeshCollider: _rebuildMeshCollider,
    bulkSpawnStaticBoxes: _bulkSpawnStaticBoxes,
    addCompoundCollider: _addCompoundCollider,
    getSensorState: _getSensorState,
    updateSensorState: _updateSensorState,

    _getBvhLoadState: (colliderId: number) => {
      const pending = ctx._pendingBvhLoads.get(colliderId);
      if (!pending) return null;
      return {
        ready: pending.ready,
        abort: () => pending.ac.abort(),
      };
    },

    getCollisionContacts: (opts) =>
      opts?.max !== undefined
        ? ctx.currentFrameContacts.slice(0, opts.max)
        : ctx.currentFrameContacts,

    getCollisionEventMetrics: () => ({ eventCount: ctx.lastFrameEventCount }),

    getBodySnapshot: (entityId) => {
      const owned = guardOwned(ctx, entityId, "getBodySnapshot");
      if (!owned) return undefined;
      const state = _getBodyState(entityId);
      return {
        entityId: owned.eid,
        position: state?.position ?? null,
        rotation: state?.rotation ?? null,
        linearVelocity: state?.linearVelocity ?? null,
        angularVelocity: state?.angularVelocity ?? null,
      };
    },

    getBodyCount: () => ctx.bodyByEntity.size,

    isDebugEnabled: () => ctx.cfg.debug,

    // Joint methods
    ...jointMethods,

    // Force, gravity, axis-lock, sleep methods
    ...forceMethods,

    // Pathfinding
    ...pathMethods,

    // Spatial queries
    ...spatialMethods,

    // Character controller
    ...ccMethods,
  };

  // ─── Plugin lifecycle ─────────────────────────────────────────────────────────

  return {
    name: "@gwenjs/physics3d",

    setup(engine: GwenEngine): void {
      ctx._engine = engine;
      ctx.log = engine.logger?.child("@gwenjs/physics3d") ?? ctx.log;
      // boundary: WASM bridge runtime is wider than the public GwenWasmModules handle.
      const bridge = getWasmBridge() as unknown as Physics3DBridgeRuntime;
      ctx._variant = bridge.variant;
      ctx.bridgeRuntime = bridge;

      if (ctx._variant !== "physics3d") {
        throw new GwenError(
          Physics3DErrorCodes.WASM_VARIANT_MISMATCH,
          `[GWEN:Physics3D] Active core variant is "${ctx._variant}". ` +
            'Pass variant: "physics3d" when initialising WasmBridgeImpl.',
        );
      }

      const pb = bridge.getPhysicsBridge();

      if (typeof pb.physics3d_init !== "function") {
        throw new GwenError(
          Physics3DErrorCodes.WASM_VARIANT_MISMATCH,
          "[GWEN:Physics3D] physics3d_init() is not available in current WASM exports.",
        );
      }

      pb.physics3d_init(cfg.gravity.x, cfg.gravity.y, cfg.gravity.z, cfg.maxEntities);

      if (typeof pb.physics3d_set_quality === "function") {
        pb.physics3d_set_quality(QUALITY_PRESETS[cfg.qualityPreset]);
      }

      if (typeof pb.physics3d_set_event_coalescing === "function") {
        pb.physics3d_set_event_coalescing(cfg.coalesceEvents ? 1 : 0);
      }

      ctx.stepFn = typeof pb.physics3d_step === "function" ? pb.physics3d_step.bind(pb) : null;

      // Detect WASM backend: if physics3d_add_body is exported, delegate to Rapier3D
      if (typeof pb.physics3d_add_body === "function") {
        ctx.backendMode = "wasm";
        ctx.wasmBridge = pb;

        const ccSabPtr = pb.physics3d_get_cc_sab_ptr?.() ?? 0;
        if (ccSabPtr > 0) {
          ctx.ccState = engine.memory.view({
            name: "physics3d:cc-state",
            type: "f32",
            ptr: () => pb.physics3d_get_cc_sab_ptr?.() ?? 0,
            length: () => {
              const maxCC = pb.physics3d_get_max_cc_entities?.() ?? 32;
              return maxCC * ctx.CC_STATE_STRIDE;
            },
          });
        }
      }

      ctx.ready = true;

      // Register prefab extension handler
      ctx.offPrefabInstantiate = engine.hooks.hook("prefab:instantiate", (entityId, extensions) => {
        const ext = (extensions as Record<string, unknown>)?.physics3d as
          | Physics3DPrefabExtension
          | undefined;
        if (!ext?.body) return;

        _createBody(entityId, ext.body);

        if (ext.onCollision) {
          ctx.entityCollisionCallbacks.set(entitySlot(entityId), ext.onCollision);
        }
      });

      ctx.offEntityDestroyed = engine.hooks.hook("entity:destroy", (entityId: EntityId) => {
        const slot = entitySlot(entityId);
        const handle = ctx.bodyByEntity.get(slot);
        const owner = handle?.entityId;
        // Another live id already owns the slot. Leave its callbacks and body alone.
        if (owner !== undefined && owner !== entityId) return;
        ctx.entityCollisionCallbacks.delete(slot);
        ctx.localSensorStates.delete(slot);
        if (owner === entityId) _removeBody(entityId);
      });

      ctx.offEngineBeforeUpdate = engine.hooks.hook("engine:before-update", (deltaTime: number) => {
        if (!ctx.ready || !ctx.stepFn) return;
        if (!(deltaTime > 0)) return;
        ctx.stepFn(deltaTime);
        if (ctx.backendMode === "local") {
          advanceLocalState(ctx, deltaTime);
        }
        clearOwnerChanges(ctx);
      });

      ctx.offEngineUpdate = engine.hooks.hook("engine:update", (_dt: number) => {
        if (!ctx.ready || !ctx._engine) return;

        // Read events from WASM, or run local AABB collision detection
        const rawEvents =
          ctx.backendMode === "wasm" ? readWasmCollisionEvents(ctx) : detectLocalCollisions(ctx);

        const contacts: Physics3DCollisionContact[] = [];
        for (const ev of rawEvents) {
          const entityA = ownerEntityId(ctx, ev.slotA);
          const entityB = ownerEntityId(ctx, ev.slotB);
          if (entityA === undefined || entityB === undefined) continue;
          contacts.push({
            entityA,
            entityB,
            ...(ev.aColliderId !== undefined ? { aColliderId: ev.aColliderId } : {}),
            ...(ev.bColliderId !== undefined ? { bColliderId: ev.bColliderId } : {}),
            started: ev.started,
          });
        }

        ctx.currentFrameContacts = contacts;

        // Track event count for metrics (includes local AABB events in fallback mode)
        if (ctx.backendMode === "local") ctx.lastFrameEventCount = rawEvents.length;

        if (contacts.length === 0) return;

        // Dispatch hook
        reportRejectedHook(
          ctx._engine,
          "@gwenjs/physics3d",
          "physics3d:collision",
          ctx._engine.hooks.callHook("physics3d:collision", contacts),
        );

        // Dispatch to composable onContact() callbacks
        for (const contact of contacts) {
          _dispatchContactEvent(contact);
        }

        // Update sensor states and dispatch sensor:changed hook
        for (const ev of rawEvents) {
          for (const { slot, colliderId } of [
            { slot: ev.slotA, colliderId: ev.aColliderId },
            { slot: ev.slotB, colliderId: ev.bColliderId },
          ]) {
            if (colliderId === undefined) continue;

            const eid = ownerEntityId(ctx, slot);
            if (eid === undefined) continue;

            const entitySlot = slot;
            let sensorMap = ctx.localSensorStates.get(entitySlot);
            if (!sensorMap) {
              sensorMap = new Map();
              ctx.localSensorStates.set(entitySlot, sensorMap);
            }
            const prev = sensorMap.get(colliderId) ?? { contactCount: 0, isActive: false };
            const newCount = ev.started
              ? prev.contactCount + 1
              : Math.max(0, prev.contactCount - 1);
            const newActive = newCount > 0;
            const next: Physics3DSensorState = { contactCount: newCount, isActive: newActive };
            sensorMap.set(colliderId, next);

            if (prev.isActive !== newActive) {
              reportRejectedHook(
                ctx._engine,
                "@gwenjs/physics3d",
                "physics3d:sensor:changed",
                ctx._engine.hooks.callHook("physics3d:sensor:changed", eid, colliderId, next),
              );
              if (newActive) {
                _dispatchSensorEnter(colliderId, eid);
              } else {
                _dispatchSensorExit(colliderId, eid);
              }
            }
          }
        }

        // Dispatch per-entity collision callbacks
        for (const contact of contacts) {
          const slotA = entitySlot(contact.entityA);
          const slotB = entitySlot(contact.entityB);
          ctx.entityCollisionCallbacks.get(slotA)?.(contact.entityA, contact.entityB, contact);
          ctx.entityCollisionCallbacks.get(slotB)?.(contact.entityB, contact.entityA, contact);
        }
      });

      engine.provide("physics3d", service);

      if (cfg.debug) {
        ctx.log.debug(`Initialized. Backend=${ctx.backendMode} quality=${cfg.qualityPreset}`);
      }
    },

    teardown(): void {
      if (ctx.offPrefabInstantiate) {
        ctx.offPrefabInstantiate();
        ctx.offPrefabInstantiate = null;
      }
      if (ctx.offEntityDestroyed) {
        ctx.offEntityDestroyed();
        ctx.offEntityDestroyed = null;
      }
      if (ctx.offEngineBeforeUpdate) {
        ctx.offEngineBeforeUpdate();
        ctx.offEngineBeforeUpdate = null;
      }
      if (ctx.offEngineUpdate) {
        ctx.offEngineUpdate();
        ctx.offEngineUpdate = null;
      }
      ctx.ready = false;
      _clearContactCallbacks();
      _clearSensorCallbacks();
      ctx.stepFn = null;
      ctx.backendMode = "local";
      ctx.wasmBridge = null;
      ctx.bridgeRuntime = null;
      ctx._engine = null;
      ctx.collisionEvents?.dispose();
      ctx.collisionEvents = null;
      ctx.ccState?.dispose();
      ctx.ccState = null;
      ctx.overlapScratch?.dispose();
      ctx.overlapScratch = null;
      ctx.bodyByEntity.clear();
      ctx.stateByEntity.clear();
      ctx.localColliders.clear();
      ctx.localSensorStates.clear();
      ctx.entityCollisionCallbacks.clear();
      ctx.currentFrameContacts = [];
      ctx.lastFrameEventCount = 0;
      ctx.pooledEvents.length = 0;
      ctx.previousLocalContactKeys.clear();
      ctx.ownerChangedSinceStep.clear();
    },
  };
});

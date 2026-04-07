import { definePlugin } from '@gwenjs/kit/plugin';
import { getWasmBridge, createEntityId, unpackEntityId } from '@gwenjs/core';
import type { EntityId, GwenEngine } from '@gwenjs/core';

import type {
  Physics3DAPI,
  Physics3DConfig,
  Physics3DCollisionContact,
  Physics3DPrefabExtension,
  Physics3DSensorState,
  Physics3DEntityId,
} from '../types';

import {
  normalizePhysics3DConfig,
  buildLayerRegistry,
  QUALITY_PRESETS,
} from '../config';

import { _dispatchContactEvent, _clearContactCallbacks } from '../composables/on-contact';
import {
  _dispatchSensorEnter,
  _dispatchSensorExit,
  _clearSensorCallbacks,
} from '../composables/on-sensor';

import type { Physics3DBridgeRuntime } from './bridge';
import { toEntityIndex } from './physics3d-utils';
import { createPluginContext } from './plugin-context';

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
} from './body-management';

import {
  addColliderImpl,
  createAddCollider,
  createRemoveCollider,
  createRebuildMeshCollider,
  createBulkSpawnStaticBoxes,
  createAddCompoundCollider,
} from './collider-management';

import { createGetSensorState, createUpdateSensorState } from './sensor-management';

import { detectLocalCollisions, readWasmCollisionEvents } from './collision-events';

import { createJointMethods } from './joint-management';

import { createForcesAndConstraints } from './forces-and-constraints';

import { createCharacterControllerMethods } from './character-controller';

import { createSpatialQueryMethods } from './spatial-queries';

import { createPathfindingMethods } from './pathfinding-service';


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

  const _createBody = (
    entityId: Physics3DEntityId,
    options = {},
  ) => createBody(ctx, entityId, options, (eid, opts) => addColliderImpl(ctx, eid, opts));

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
        throw new Error('[GWEN:Physics3D] step() called before plugin initialization.');
      }
      ctx.stepFn(deltaSeconds);
      if (deltaSeconds > 0 && ctx.backendMode === 'local') {
        advanceLocalState(ctx, deltaSeconds);
      }
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
      opts?.max !== undefined ? ctx.currentFrameContacts.slice(0, opts.max) : ctx.currentFrameContacts,

    getCollisionEventMetrics: () => ({ eventCount: ctx.lastFrameEventCount }),

    getBodySnapshot: (entityId) => {
      if (!ctx.bodyByEntity.has(toEntityIndex(entityId))) return undefined;
      const state = _getBodyState(entityId);
      return {
        entityId,
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
    name: '@gwenjs/physics3d',

    setup(engine: GwenEngine): void {
      ctx._engine = engine;
      const bridge = getWasmBridge() as unknown as Physics3DBridgeRuntime;
      ctx._variant = bridge.variant;
      ctx.bridgeRuntime = bridge;

      if (ctx._variant !== 'physics3d') {
        throw new Error(
          `[GWEN:Physics3D] Active core variant is "${ctx._variant}". ` +
            'Use initWasm("physics3d") before starting the engine.',
        );
      }

      const pb = bridge.getPhysicsBridge();

      if (typeof pb.physics3d_init !== 'function') {
        throw new Error(
          '[GWEN:Physics3D] physics3d_init() is not available in current WASM exports.',
        );
      }

      pb.physics3d_init(cfg.gravity.x, cfg.gravity.y, cfg.gravity.z, cfg.maxEntities);

      if (typeof pb.physics3d_set_quality === 'function') {
        pb.physics3d_set_quality(QUALITY_PRESETS[cfg.qualityPreset]);
      }

      if (typeof pb.physics3d_set_event_coalescing === 'function') {
        pb.physics3d_set_event_coalescing(cfg.coalesceEvents ? 1 : 0);
      }

      ctx.stepFn = typeof pb.physics3d_step === 'function' ? pb.physics3d_step.bind(pb) : null;

      // Detect WASM backend: if physics3d_add_body is exported, delegate to Rapier3D
      if (typeof pb.physics3d_add_body === 'function') {
        ctx.backendMode = 'wasm';
        ctx.wasmBridge = pb;

        // Populate CC SAB view from WASM linear memory
        const ccSabPtr = pb.physics3d_get_cc_sab_ptr?.() ?? 0;
        const maxCC = pb.physics3d_get_max_cc_entities?.() ?? 32;
        if (ccSabPtr > 0) {
          const mem = ctx.bridgeRuntime?.getLinearMemory?.() ?? null;
          if (mem) {
            ctx.ccSABView.view = new Float32Array(mem.buffer, ccSabPtr, maxCC * ctx.CC_STATE_STRIDE);
          }
        }
      }

      ctx.ready = true;

      // Register prefab extension handler
      engine.hooks.hook('prefab:instantiate', (entityId, extensions) => {
        const ext = (extensions as Record<string, unknown>)?.physics3d as
          | Physics3DPrefabExtension
          | undefined;
        if (!ext?.body) return;

        const eid = entityId as Physics3DEntityId;
        _createBody(eid, ext.body);

        if (ext.onCollision) {
          const slot =
            typeof eid === 'bigint'
              ? unpackEntityId(eid as EntityId).index
              : typeof eid === 'number'
                ? eid
                : parseInt(String(eid), 10);
          ctx.entityCollisionCallbacks.set(slot, ext.onCollision);
        }
      });

      ctx.offEntityDestroyed = engine.hooks.hook('entity:destroy', (entityId: EntityId) => {
        if (
          typeof entityId === 'bigint' ||
          typeof entityId === 'number' ||
          typeof entityId === 'string'
        ) {
          const eid = entityId as Physics3DEntityId;
          const slot =
            typeof eid === 'bigint'
              ? Number((eid as bigint) & 0xffffffffn)
              : typeof eid === 'number'
                ? eid
                : parseInt(String(eid), 10);
          ctx.entityCollisionCallbacks.delete(slot);
          _removeBody(eid);
          // Clean up all sensor states for this entity in O(1)
          ctx.localSensorStates.delete(slot);
        }
      });

      engine.provide('physics3d', service);

      if (cfg.debug) {
        // eslint-disable-next-line no-console
        console.log(
          `[GWEN:Physics3D] Initialized. Backend=${ctx.backendMode} quality=${cfg.qualityPreset}`,
        );
      }
    },

    onBeforeUpdate(deltaTime: number): void {
      if (!ctx.ready || !ctx.stepFn) return;
      if (!(deltaTime > 0)) return;
      ctx.stepFn(deltaTime);
      if (ctx.backendMode === 'local') {
        advanceLocalState(ctx, deltaTime);
      }
    },

    onUpdate(): void {
      if (!ctx.ready || !ctx._engine) return;

      // Invalidate DataView if memory buffer changed (memory.grow event)
      if (ctx.eventsView && ctx.backendMode === 'wasm') {
        const memory = ctx.bridgeRuntime?.getLinearMemory?.() ?? ctx.wasmBridge?.memory ?? null;
        if (memory && ctx.eventsBufferRef !== memory.buffer) {
          ctx.eventsView = null;
          ctx.eventsBufferRef = null;
        }
      }

      // Re-validate CC SAB view after WASM memory.grow
      if (ctx.ccSABView.view !== null && ctx.backendMode === 'wasm') {
        const mem = ctx.bridgeRuntime?.getLinearMemory?.() ?? null;
        if (mem !== null && ctx.ccSABView.view.buffer !== mem.buffer) {
          const ccSabPtr2 = ctx.wasmBridge!.physics3d_get_cc_sab_ptr?.() ?? 0;
          const maxCC2 = ctx.wasmBridge!.physics3d_get_max_cc_entities?.() ?? 32;
          if (ccSabPtr2 > 0) {
            ctx.ccSABView.view = new Float32Array(mem.buffer, ccSabPtr2, maxCC2 * ctx.CC_STATE_STRIDE);
          } else {
            ctx.ccSABView.view = null;
          }
        }
      }

      // Read events from WASM, or run local AABB collision detection
      const rawEvents =
        ctx.backendMode === 'wasm' ? readWasmCollisionEvents(ctx) : detectLocalCollisions(ctx);

      // Build resolved contacts — in local mode entity ids are slot bigints
      const contacts: Physics3DCollisionContact[] = rawEvents.map((ev) => {
        let entityA: EntityId;
        let entityB: EntityId;
        if (ctx.backendMode === 'wasm') {
          const genA = ctx.bridgeRuntime?.getEntityGeneration?.(ev.slotA);
          const genB = ctx.bridgeRuntime?.getEntityGeneration?.(ev.slotB);
          entityA =
            genA !== undefined ? createEntityId(ev.slotA, genA) : (BigInt(ev.slotA) as EntityId);
          entityB =
            genB !== undefined ? createEntityId(ev.slotB, genB) : (BigInt(ev.slotB) as EntityId);
        } else {
          entityA = BigInt(ev.slotA) as EntityId;
          entityB = BigInt(ev.slotB) as EntityId;
        }
        return {
          entityA,
          entityB,
          ...(ev.aColliderId !== undefined ? { aColliderId: ev.aColliderId } : {}),
          ...(ev.bColliderId !== undefined ? { bColliderId: ev.bColliderId } : {}),
          started: ev.started,
        };
      });

      ctx.currentFrameContacts = contacts;

      // Track event count for metrics (includes local AABB events in fallback mode)
      if (ctx.backendMode === 'local') ctx.lastFrameEventCount = rawEvents.length;

      if (contacts.length === 0) return;

      // Dispatch hook
      void ctx._engine.hooks.callHook('physics3d:collision', contacts);

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

          let eid: EntityId;
          if (ctx.backendMode === 'wasm') {
            const generation = ctx.bridgeRuntime?.getEntityGeneration?.(slot);
            if (generation === undefined) continue;
            eid = createEntityId(slot, generation);
          } else {
            eid = BigInt(slot) as EntityId;
          }

          const entitySlot = slot;
          let sensorMap = ctx.localSensorStates.get(entitySlot);
          if (!sensorMap) {
            sensorMap = new Map();
            ctx.localSensorStates.set(entitySlot, sensorMap);
          }
          const prev = sensorMap.get(colliderId) ?? { contactCount: 0, isActive: false };
          const newCount = ev.started ? prev.contactCount + 1 : Math.max(0, prev.contactCount - 1);
          const newActive = newCount > 0;
          const next: Physics3DSensorState = { contactCount: newCount, isActive: newActive };
          sensorMap.set(colliderId, next);

          if (prev.isActive !== newActive) {
            void ctx._engine.hooks.callHook('physics3d:sensor:changed', eid, colliderId, next);
            if (newActive) {
              _dispatchSensorEnter(colliderId, eid as unknown as bigint);
            } else {
              _dispatchSensorExit(colliderId, eid as unknown as bigint);
            }
          }
        }
      }

      // Dispatch per-entity collision callbacks
      for (const contact of contacts) {
        const slotA = unpackEntityId(contact.entityA).index;
        const slotB = unpackEntityId(contact.entityB).index;
        ctx.entityCollisionCallbacks.get(slotA)?.(contact.entityA, contact.entityB, contact);
        ctx.entityCollisionCallbacks.get(slotB)?.(contact.entityB, contact.entityA, contact);
      }
    },

    teardown(): void {
      if (ctx.offEntityDestroyed) {
        ctx.offEntityDestroyed();
        ctx.offEntityDestroyed = null;
      }
      ctx.ready = false;
      _clearContactCallbacks();
      _clearSensorCallbacks();
      ctx.stepFn = null;
      ctx.backendMode = 'local';
      ctx.wasmBridge = null;
      ctx.bridgeRuntime = null;
      ctx._engine = null;
      ctx.eventsView = null;
      ctx.eventsBufferRef = null;
      ctx.bodyByEntity.clear();
      ctx.stateByEntity.clear();
      ctx.localColliders.clear();
      ctx.localSensorStates.clear();
      ctx.entityCollisionCallbacks.clear();
      ctx.currentFrameContacts = [];
      ctx.lastFrameEventCount = 0;
      ctx.pooledEvents.length = 0;
      ctx.previousLocalContactKeys.clear();
    },
  };
});

/**
 * @fileoverview Collider creation, removal, rebuild, and compound collider support.
 *
 * Also contains the bulk static box spawning logic.
 */

import type { EntityId } from '@gwenjs/core';
import type {
  Physics3DAPI,
  Physics3DBodyHandle,
  Physics3DColliderOptions,
  Physics3DEntityId,
  CompoundShapeSpec,
  BulkStaticBoxesOptions,
  BulkStaticBoxesResult,
} from '../types';
import { resolveLayerBits } from '../config';
import { encodeCompoundShapes } from '../helpers/compound';
import { nextColliderId } from '../composables/collider-id';
import {
  _fetchBvhBuffer,
  getBvhWorker,
  BVH_WORKER_THRESHOLD,
  _bvhWorkerCallbacks,
  getNextBvhJobId,
  registerBvhCallback,
} from './bvh';
import { toEntityIndex, resolveColliderMaterial } from './physics3d-utils';
import { nextColliderIdForEntity } from './plugin-helpers';
import { createBodyLocal } from './body-management';
import type { PluginContext } from './plugin-context';

// ─── Helper ────────────────────────────────────────────────────────────────────

/** Convert a single {@link CompoundShapeSpec} entry into {@link Physics3DColliderOptions}. */
export function shapeSpecToColliderOptions(
  shape: CompoundShapeSpec,
  colliderId: number,
  layers: (string | number)[] | undefined,
  mask: (string | number)[] | undefined,
): Physics3DColliderOptions {
  const common = {
    colliderId,
    offsetX: shape.offsetX,
    offsetY: shape.offsetY,
    offsetZ: shape.offsetZ,
    isSensor: shape.isSensor,
    friction: shape.friction,
    restitution: shape.restitution,
    layers,
    mask,
  };
  switch (shape.type) {
    case 'box':
      return {
        ...common,
        shape: { type: 'box', halfX: shape.halfX, halfY: shape.halfY, halfZ: shape.halfZ },
      };
    case 'sphere':
      return { ...common, shape: { type: 'sphere', radius: shape.radius } };
    case 'capsule':
      return {
        ...common,
        shape: { type: 'capsule', radius: shape.radius, halfHeight: shape.halfHeight },
      };
  }
}

// ─── Core collider implementation ──────────────────────────────────────────────

/**
 * Internal implementation of addCollider — shared by createBody collider loop
 * and the public addCollider API method.
 */
export function addColliderImpl(
  ctx: PluginContext,
  entityId: Physics3DEntityId,
  options: Physics3DColliderOptions,
): boolean {
  const slot = toEntityIndex(entityId);
  if (!ctx.bodyByEntity.has(slot)) return false;

  const colliderId = options.colliderId ?? nextColliderIdForEntity(ctx, slot);
  const finalOptions: Physics3DColliderOptions = { ...options, colliderId };

  // Always track in the local collider registry for inspection
  if (!ctx.localColliders.has(slot)) ctx.localColliders.set(slot, []);
  ctx.localColliders.get(slot)!.push(finalOptions);

  if (ctx.backendMode === 'wasm') {
    const idx = toEntityIndex(entityId);
    const { friction, restitution, density } = resolveColliderMaterial(finalOptions);
    const isSensor = finalOptions.isSensor ? 1 : 0;
    const membership = resolveLayerBits(finalOptions.layers, ctx.layerRegistry);
    const filter = resolveLayerBits(finalOptions.mask, ctx.layerRegistry);
    const ox = finalOptions.offsetX ?? 0;
    const oy = finalOptions.offsetY ?? 0;
    const oz = finalOptions.offsetZ ?? 0;
    const shape = finalOptions.shape;

    if (shape.type === 'box') {
      return (
        ctx.wasmBridge!.physics3d_add_box_collider?.(
          idx,
          shape.halfX, shape.halfY, shape.halfZ,
          friction, restitution, density, isSensor,
          membership, filter, colliderId,
          ox, oy, oz,
        ) ?? false
      );
    }
    if (shape.type === 'sphere') {
      return (
        ctx.wasmBridge!.physics3d_add_sphere_collider?.(
          idx,
          shape.radius,
          friction, restitution, density, isSensor,
          membership, filter, colliderId,
          ox, oy, oz,
        ) ?? false
      );
    }
    if (shape.type === 'capsule') {
      return (
        ctx.wasmBridge!.physics3d_add_capsule_collider?.(
          idx,
          shape.radius, shape.halfHeight,
          friction, restitution, density, isSensor,
          membership, filter, colliderId,
          ox, oy, oz,
        ) ?? false
      );
    }
    if (shape.type === 'heightfield') {
      return (
        ctx.wasmBridge!.physics3d_add_heightfield_collider?.(
          idx,
          shape.heights, shape.rows, shape.cols,
          shape.scaleX ?? 1, shape.scaleY ?? 1, shape.scaleZ ?? 1,
          friction, restitution,
          membership, filter, colliderId,
        ) ?? false
      );
    }
    if (shape.type === 'mesh') {
      // ── Async path: pre-baked BVH URL ───────────────────────────────────
      if (finalOptions.__bvhUrl) {
        const bvhUrl = finalOptions.__bvhUrl;
        const ac = new AbortController();
        let resolveReady!: () => void;
        let rejectReady!: (e: unknown) => void;
        const ready = new Promise<void>((res, rej) => {
          resolveReady = res;
          rejectReady = rej;
        });

        _fetchBvhBuffer(bvhUrl)
          .then((ab) => {
            if (ac.signal.aborted) return;
            const ok =
              ctx.wasmBridge!.physics3d_load_bvh_collider?.(
                idx,
                new Uint8Array(ab),
                ox, oy, oz,
                finalOptions.isSensor ?? false,
                friction, restitution,
                membership, filter, colliderId,
              ) ?? false;
            if (ok) resolveReady();
            else
              rejectReady(
                new Error('[GWEN:Physics3D] physics3d_load_bvh_collider returned false'),
              );
          })
          .catch(rejectReady);

        ctx._pendingBvhLoads.set(colliderId, { ac, ready });
        return true;
      }
      // ── Sync path: inline vertices + indices ─────────────────────────────
      const triCount = shape.indices.length / 3;
      if (triCount >= BVH_WORKER_THRESHOLD && typeof Worker !== 'undefined') {
        const jobId = getNextBvhJobId();
        const ac = new AbortController();
        let resolveReady!: () => void;
        let rejectReady!: (e: unknown) => void;
        const ready = new Promise<void>((res, rej) => {
          resolveReady = res;
          rejectReady = rej;
        });

        registerBvhCallback(
          jobId,
          (bvhBytes: Uint8Array) => {
            if (ac.signal.aborted) return;
            const ok =
              ctx.wasmBridge!.physics3d_load_bvh_collider?.(
                idx,
                bvhBytes,
                ox, oy, oz,
                finalOptions.isSensor ?? false,
                friction, restitution,
                membership, filter, colliderId,
              ) ?? false;
            if (ok) resolveReady();
            else
              rejectReady(
                new Error('[GWEN:Physics3D] physics3d_load_bvh_collider returned false'),
              );
          },
          rejectReady,
        );

        try {
          const vBuf = shape.vertices.buffer.slice(0) as ArrayBuffer;
          const iBuf = shape.indices.buffer.slice(0) as ArrayBuffer;
          getBvhWorker().postMessage(
            {
              id: jobId,
              vertices: new Float32Array(vBuf),
              indices: new Uint32Array(iBuf),
            },
            [vBuf, iBuf],
          );
        } catch (e) {
          _bvhWorkerCallbacks.delete(jobId);
          rejectReady(e);
        }

        ctx._pendingBvhLoads.set(colliderId, { ac, ready });
        return true;
      }

      return (
        ctx.wasmBridge!.physics3d_add_mesh_collider?.(
          idx,
          shape.vertices, shape.indices,
          ox, oy, oz,
          isSensor, friction, restitution,
          membership, filter, colliderId,
        ) ?? false
      );
    }
    if (shape.type === 'convex') {
      return (
        ctx.wasmBridge!.physics3d_add_convex_collider?.(
          idx,
          shape.vertices,
          ox, oy, oz,
          isSensor, friction, restitution, density,
          membership, filter, colliderId,
        ) ?? false
      );
    }
  }

  // Emit warnings for unimplemented shape types in local mode
  if (ctx.backendMode === 'local') {
    const shape = finalOptions.shape;
    if (shape.type === 'mesh') {
      console.warn(
        '[PHYSICS3D:MESH_FALLBACK] useMeshCollider() is not yet fully implemented. ' +
          'Falling back to a 1×1×1 box collider. Upgrade to a build with RFC-06b support.',
      );
    } else if (shape.type === 'convex') {
      console.warn(
        '[PHYSICS3D:CONVEX_FALLBACK] useConvexCollider() is not yet fully implemented. ' +
          'Falling back to a 1×1×1 box collider. Upgrade to a build with RFC-06b support.',
      );
    }
  }

  return true;
}

// ─── Public collider API methods ───────────────────────────────────────────────

export function createAddCollider(ctx: PluginContext): Physics3DAPI['addCollider'] {
  return (entityId, options) => addColliderImpl(ctx, entityId, options);
}

export function createRemoveCollider(ctx: PluginContext): Physics3DAPI['removeCollider'] {
  return (entityId, colliderId) => {
    const slot = toEntityIndex(entityId);
    if (!ctx.bodyByEntity.has(slot)) return false;

    const colliders = ctx.localColliders.get(slot);
    if (colliders) {
      const idx = colliders.findIndex((c) => c.colliderId === colliderId);
      if (idx !== -1) colliders.splice(idx, 1);
    }

    if (ctx.backendMode === 'wasm') {
      return ctx.wasmBridge!.physics3d_remove_collider?.(slot, colliderId) ?? false;
    }

    return true;
  };
}

export function createRebuildMeshCollider(ctx: PluginContext): Physics3DAPI['rebuildMeshCollider'] {
  return (entityId, colliderId, vertices, indices, options) => {
    const slot = toEntityIndex(entityId);
    if (!ctx.bodyByEntity.has(slot)) return false;

    const colliders = ctx.localColliders.get(slot);
    if (colliders) {
      const entry = colliders.find((c) => c.colliderId === colliderId);
      if (entry && entry.shape.type === 'mesh') {
        entry.shape.vertices = vertices;
        entry.shape.indices = indices;
      }
    }

    if (ctx.backendMode !== 'wasm') return true;

    const { friction, restitution } = resolveColliderMaterial({
      ...options,
    } as Physics3DColliderOptions);
    const isSensor = options?.isSensor ?? false;
    const membership = resolveLayerBits(options?.layers, ctx.layerRegistry);
    const filter = resolveLayerBits(options?.mask, ctx.layerRegistry);

    return (
      ctx.wasmBridge!.physics3d_rebuild_mesh_collider?.(
        slot, colliderId,
        vertices, indices,
        0, 0, 0,
        isSensor, friction, restitution,
        membership, filter,
      ) ?? false
    );
  };
}

// ─── Bulk spawn static boxes ───────────────────────────────────────────────────

export function createBulkSpawnStaticBoxes(
  ctx: PluginContext,
): (options: BulkStaticBoxesOptions) => BulkStaticBoxesResult {
  return (options) => {
    if (options.positions.length % 3 !== 0) {
      throw new RangeError(
        `[GWEN:Physics3D] positions.length must be a multiple of 3, got ${options.positions.length}`,
      );
    }
    const n = options.positions.length / 3;
    const friction = options.friction ?? 0.5;
    const restitution = options.restitution ?? 0.0;
    const membership = resolveLayerBits(options.layers, ctx.layerRegistry);
    const filter = resolveLayerBits(options.mask, ctx.layerRegistry);

    const entityIds: EntityId[] = [];
    const entityIndices = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      const eid = ctx._engine!.createEntity();
      entityIds.push(eid);
      entityIndices[i] = toEntityIndex(eid as unknown as Physics3DEntityId);
    }

    if (ctx.backendMode === 'wasm' && ctx.wasmBridge!.physics3d_bulk_spawn_static_boxes) {
      const spawned = ctx.wasmBridge!.physics3d_bulk_spawn_static_boxes(
        entityIndices,
        options.positions,
        options.halfExtents,
        friction, restitution,
        membership, filter,
      );
      for (let i = 0; i < spawned; i++) {
        const handle: Physics3DBodyHandle = {
          bodyId: ctx.nextBodyId++,
          entityId: entityIds[i] as unknown as Physics3DEntityId,
          kind: 'fixed',
          mass: 0,
          linearDamping: 0,
          angularDamping: 0,
        };
        ctx.bodyByEntity.set(entityIndices[i]!, handle);
      }
      return { entityIds: entityIds.slice(0, spawned), count: spawned };
    }

    // Local fallback
    for (let i = 0; i < n; i++) {
      const px = options.positions[i * 3]!;
      const py = options.positions[i * 3 + 1]!;
      const pz = options.positions[i * 3 + 2]!;
      const uniform = options.halfExtents.length === 3;
      const hx = uniform ? options.halfExtents[0]! : options.halfExtents[i * 3]!;
      const hy = uniform ? options.halfExtents[1]! : options.halfExtents[i * 3 + 1]!;
      const hz = uniform ? options.halfExtents[2]! : options.halfExtents[i * 3 + 2]!;

      createBodyLocal(ctx, entityIds[i] as unknown as Physics3DEntityId, {
        kind: 'fixed',
        initialPosition: { x: px, y: py, z: pz },
        colliders: [
          {
            shape: { type: 'box', halfX: hx, halfY: hy, halfZ: hz },
            friction,
            restitution,
            layers: options.layers,
            mask: options.mask,
          },
        ],
      });
    }
    return { entityIds, count: n };
  };
}

// ─── Compound collider ─────────────────────────────────────────────────────────

export function createAddCompoundCollider(ctx: PluginContext): Physics3DAPI['addCompoundCollider'] {
  const removeCollider = createRemoveCollider(ctx);

  return (entityId, options) => {
    const slot = toEntityIndex(entityId);
    if (!ctx.bodyByEntity.has(slot)) return null;

    const { shapes, layers, mask } = options;
    const colliderIds = shapes.map(() => nextColliderId());

    if (ctx.backendMode === 'wasm' && ctx.wasmBridge?.physics3d_add_compound_collider) {
      const layerBits = resolveLayerBits(layers, ctx.layerRegistry);
      const maskBits = resolveLayerBits(mask, ctx.layerRegistry);
      const buf = encodeCompoundShapes(shapes, colliderIds);
      const count = ctx.wasmBridge.physics3d_add_compound_collider(slot, buf, layerBits, maskBits);

      if (count !== shapes.length) return null;

      if (!ctx.localColliders.has(slot)) ctx.localColliders.set(slot, []);
      shapes.forEach((shape, i) => {
        ctx.localColliders
          .get(slot)!
          .push(shapeSpecToColliderOptions(shape, colliderIds[i]!, layers, mask));
      });
    } else {
      shapes.forEach((shape, i) => {
        addColliderImpl(ctx, entityId, shapeSpecToColliderOptions(shape, colliderIds[i]!, layers, mask));
      });
    }

    return {
      colliderIds,
      remove() {
        colliderIds.forEach((id) => removeCollider(entityId, id));
      },
    };
  };
}

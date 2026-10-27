/**
 * @fileoverview Collider creation, removal, rebuild, and compound collider support.
 *
 * Also contains the bulk static box spawning logic.
 */

import type {
  Physics3DAPI,
  Physics3DBodyHandle,
  Physics3DColliderOptions,
  Physics3DEntityId,
  CompoundShapeSpec,
  BulkStaticBoxesOptions,
  BulkStaticBoxesResult,
} from "../types";
import { resolveLayerBits } from "../config";
import { encodeCompoundShapes } from "../helpers/compound";
import { nextColliderId } from "../composables/collider-id";
import {
  _fetchBvhBuffer,
  getBvhWorker,
  BVH_WORKER_THRESHOLD,
  _bvhWorkerCallbacks,
  getNextBvhJobId,
  registerBvhCallback,
} from "./bvh";
import { resolveColliderMaterial } from "./physics3d-utils";
import { guardOwned, noteOwnerChange, ownedSlot } from "./entity-owner";
import { nextColliderIdForEntity } from "./plugin-helpers";
import { createBodyLocal } from "./body-management";
import type { PluginContext } from "./plugin-context";
import { callPhysics3DExport, hasPhysics3DCode } from "./wasm-errors";
import { entityIndex, GwenError, type EntityId } from "@gwenjs/schema";
import { Physics3DErrorCodes } from "../errors/codes";

// ─── Helper ────────────────────────────────────────────────────────────────────

/** Convert a single {@link CompoundShapeSpec} entry into {@link Physics3DColliderOptions}. */
export function shapeSpecToColliderOptions(
  shape: CompoundShapeSpec,
  colliderId: number,
  layers: (string | number)[] | undefined,
  mask: (string | number)[] | undefined,
): Physics3DColliderOptions {
  const base: Physics3DColliderOptions =
    shape.type === "box"
      ? {
          colliderId,
          shape: { type: "box", halfX: shape.halfX, halfY: shape.halfY, halfZ: shape.halfZ },
        }
      : shape.type === "sphere"
        ? { colliderId, shape: { type: "sphere", radius: shape.radius } }
        : {
            colliderId,
            shape: { type: "capsule", radius: shape.radius, halfHeight: shape.halfHeight },
          };
  return {
    ...base,
    ...(shape.offsetX !== undefined ? { offsetX: shape.offsetX } : {}),
    ...(shape.offsetY !== undefined ? { offsetY: shape.offsetY } : {}),
    ...(shape.offsetZ !== undefined ? { offsetZ: shape.offsetZ } : {}),
    ...(shape.isSensor !== undefined ? { isSensor: shape.isSensor } : {}),
    ...(shape.friction !== undefined ? { friction: shape.friction } : {}),
    ...(shape.restitution !== undefined ? { restitution: shape.restitution } : {}),
    ...(layers !== undefined ? { layers } : {}),
    ...(mask !== undefined ? { mask } : {}),
  };
}

// ─── Core collider implementation ──────────────────────────────────────────────

/**
 * Record a collider in the TypeScript registry. Returns the function that undoes
 * exactly what this call added, for a Rust rejection.
 */
function trackLocalCollider(
  ctx: PluginContext,
  slot: number,
  options: Physics3DColliderOptions,
  colliderId: number,
): () => void {
  const created = !ctx.localColliders.has(slot);
  const list = ctx.localColliders.get(slot) ?? [];
  if (created) ctx.localColliders.set(slot, list);
  list.push(options);
  let addedSensor = false;
  if (options.isSensor) {
    let sensors = ctx.activeSensors.get(slot);
    if (!sensors) {
      sensors = new Set();
      ctx.activeSensors.set(slot, sensors);
    }
    addedSensor = !sensors.has(colliderId);
    sensors.add(colliderId);
  }
  return () => {
    const at = list.lastIndexOf(options);
    if (at !== -1) list.splice(at, 1);
    if (created && list.length === 0 && ctx.localColliders.get(slot) === list) {
      ctx.localColliders.delete(slot);
    }
    if (addedSensor) ctx.activeSensors.get(slot)?.delete(colliderId);
  };
}

/** The error a BVH load reports when the export is absent: Rust never answers `false`. */
function bvhExportMissing(): GwenError {
  return new GwenError(
    Physics3DErrorCodes.BVH_LOAD_FAILED,
    "This WASM build does not export physics3d_load_bvh_collider.",
    {},
  );
}

/**
 * Add one collider through Rust. Every shape export returns `true` or throws a typed
 * error; `false` only means the export is absent from the bridge.
 */
function addColliderWasm(
  ctx: PluginContext,
  slot: number,
  finalOptions: Physics3DColliderOptions,
  colliderId: number,
): boolean {
  const idx = slot;
  const { friction, restitution, density } = resolveColliderMaterial(finalOptions);
  const isSensor = finalOptions.isSensor ?? false;
  const membership = resolveLayerBits(finalOptions.layers, ctx.layerRegistry);
  const filter = resolveLayerBits(finalOptions.mask, ctx.layerRegistry);
  const ox = finalOptions.offsetX ?? 0;
  const oy = finalOptions.offsetY ?? 0;
  const oz = finalOptions.offsetZ ?? 0;
  const shape = finalOptions.shape;

  if (shape.type === "box") {
    return callPhysics3DExport(
      ctx,
      "physics3d_add_box_collider",
      () =>
        ctx.wasmBridge!.physics3d_add_box_collider?.(
          idx,
          shape.halfX,
          shape.halfY,
          shape.halfZ,
          ox,
          oy,
          oz,
          isSensor,
          friction,
          restitution,
          membership,
          filter,
          colliderId,
        ) ?? false,
    );
  }
  if (shape.type === "sphere") {
    return callPhysics3DExport(
      ctx,
      "physics3d_add_sphere_collider",
      () =>
        ctx.wasmBridge!.physics3d_add_sphere_collider?.(
          idx,
          shape.radius,
          ox,
          oy,
          oz,
          isSensor,
          friction,
          restitution,
          membership,
          filter,
          colliderId,
        ) ?? false,
    );
  }
  if (shape.type === "capsule") {
    return callPhysics3DExport(
      ctx,
      "physics3d_add_capsule_collider",
      () =>
        ctx.wasmBridge!.physics3d_add_capsule_collider?.(
          idx,
          shape.radius,
          shape.halfHeight,
          ox,
          oy,
          oz,
          isSensor,
          friction,
          restitution,
          membership,
          filter,
          colliderId,
        ) ?? false,
    );
  }
  if (shape.type === "heightfield") {
    return callPhysics3DExport(
      ctx,
      "physics3d_add_heightfield_collider",
      () =>
        ctx.wasmBridge!.physics3d_add_heightfield_collider?.(
          idx,
          shape.heights,
          shape.rows,
          shape.cols,
          shape.scaleX ?? 1,
          shape.scaleY ?? 1,
          shape.scaleZ ?? 1,
          friction,
          restitution,
          membership,
          filter,
          colliderId,
        ) ?? false,
    );
  }
  if (shape.type === "mesh") {
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

      // A throw inside `then` reaches `catch`, which rejects `ready`.
      _fetchBvhBuffer(bvhUrl)
        .then((ab) => {
          if (ac.signal.aborted) return;
          const ok = callPhysics3DExport(
            ctx,
            "physics3d_load_bvh_collider",
            () =>
              ctx.wasmBridge!.physics3d_load_bvh_collider?.(
                idx,
                new Uint8Array(ab),
                ox,
                oy,
                oz,
                isSensor,
                friction,
                restitution,
                membership,
                filter,
                colliderId,
              ) ?? false,
          );
          if (ok) resolveReady();
          else rejectReady(bvhExportMissing());
        })
        .catch(rejectReady);

      ctx._pendingBvhLoads.set(colliderId, { ac, ready });
      return true;
    }
    // ── Sync path: inline vertices + indices ─────────────────────────────
    const triCount = shape.indices.length / 3;
    if (triCount >= BVH_WORKER_THRESHOLD && typeof Worker !== "undefined") {
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
          // The worker calls this from `onmessage`: a throw here would be lost and `ready`
          // would never settle. Reject `ready` with the typed error instead.
          try {
            const ok = callPhysics3DExport(
              ctx,
              "physics3d_load_bvh_collider",
              () =>
                ctx.wasmBridge!.physics3d_load_bvh_collider?.(
                  idx,
                  bvhBytes,
                  ox,
                  oy,
                  oz,
                  isSensor,
                  friction,
                  restitution,
                  membership,
                  filter,
                  colliderId,
                ) ?? false,
            );
            if (ok) resolveReady();
            else rejectReady(bvhExportMissing());
          } catch (err: unknown) {
            rejectReady(err);
          }
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

    return callPhysics3DExport(
      ctx,
      "physics3d_add_mesh_collider",
      () =>
        ctx.wasmBridge!.physics3d_add_mesh_collider?.(
          idx,
          shape.vertices,
          shape.indices,
          ox,
          oy,
          oz,
          isSensor,
          friction,
          restitution,
          membership,
          filter,
          colliderId,
        ) ?? false,
    );
  }
  if (shape.type === "convex") {
    return callPhysics3DExport(
      ctx,
      "physics3d_add_convex_collider",
      () =>
        ctx.wasmBridge!.physics3d_add_convex_collider?.(
          idx,
          shape.vertices,
          ox,
          oy,
          oz,
          isSensor,
          friction,
          restitution,
          density,
          membership,
          filter,
          colliderId,
        ) ?? false,
    );
  }
  return true;
}

/**
 * Internal implementation of addCollider — shared by createBody collider loop
 * and the public addCollider API method.
 *
 * In WASM mode a rejected export throws `GwenWasmError` and the registry is left as it was.
 */
export function addColliderImpl(
  ctx: PluginContext,
  entityId: Physics3DEntityId,
  options: Physics3DColliderOptions,
): boolean {
  const owned = guardOwned(ctx, entityId, "addCollider");
  if (!owned) return false;
  const slot = owned.slot;

  const colliderId = options.colliderId ?? nextColliderIdForEntity(ctx, slot);
  const finalOptions: Physics3DColliderOptions = { ...options, colliderId };

  // Always track in the local collider registry for inspection
  const undo = trackLocalCollider(ctx, slot, finalOptions, colliderId);

  if (ctx.backendMode === "wasm") {
    try {
      return addColliderWasm(ctx, slot, finalOptions, colliderId);
    } catch (err: unknown) {
      undo();
      throw err;
    }
  }

  // Emit warnings for unimplemented shape types in local mode
  const shape = finalOptions.shape;
  if (shape.type === "mesh") {
    ctx.log.warn(
      "useMeshCollider() is not yet fully implemented. " +
        "Falling back to a 1×1×1 box collider. Upgrade to a build with RFC-06b support.",
    );
  } else if (shape.type === "convex") {
    ctx.log.warn(
      "useConvexCollider() is not yet fully implemented. " +
        "Falling back to a 1×1×1 box collider. Upgrade to a build with RFC-06b support.",
    );
  }

  return true;
}

// ─── Public collider API methods ───────────────────────────────────────────────

export function createAddCollider(ctx: PluginContext): Physics3DAPI["addCollider"] {
  return (entityId, options) => addColliderImpl(ctx, entityId, options);
}

export function createRemoveCollider(ctx: PluginContext): Physics3DAPI["removeCollider"] {
  return (entityId, colliderId) => {
    const owned = ownedSlot(ctx, entityId);
    if (!owned) return false;
    const slot = owned.slot;

    const colliders = ctx.localColliders.get(slot);
    const at = colliders?.findIndex((c) => c.colliderId === colliderId) ?? -1;

    let removed = true;
    if (ctx.backendMode === "wasm") {
      // Idempotent through the registry: an id this slot never registered is `false`, as
      // before, and never reaches Rust, which would answer COLLIDER_NOT_FOUND.
      if (colliders === undefined || at === -1) return false;
      // A BVH load still in flight has no collider in Rust yet. Cancel it, then tolerate the miss.
      const pending = ctx._pendingBvhLoads.get(colliderId);
      if (pending) {
        pending.ac.abort();
        ctx._pendingBvhLoads.delete(colliderId);
      }
      // Rust first: a rejected call leaves the registry as it was.
      try {
        removed = callPhysics3DExport(
          ctx,
          "physics3d_remove_collider",
          () => ctx.wasmBridge!.physics3d_remove_collider?.(slot, colliderId) ?? false,
        );
      } catch (err: unknown) {
        if (!pending || !hasPhysics3DCode(err, Physics3DErrorCodes.COLLIDER_NOT_FOUND)) throw err;
      }
    }

    if (colliders !== undefined && at !== -1) colliders.splice(at, 1);
    ctx.activeSensors.get(slot)?.delete(colliderId);
    return removed;
  };
}

export function createRebuildMeshCollider(ctx: PluginContext): Physics3DAPI["rebuildMeshCollider"] {
  return (entityId, colliderId, vertices, indices, options) => {
    const owned = guardOwned(ctx, entityId, "rebuildMeshCollider");
    if (!owned) return false;
    const slot = owned.slot;

    const colliders = ctx.localColliders.get(slot);
    const entry = colliders?.find((c) => c.colliderId === colliderId);

    if (ctx.backendMode === "wasm") {
      const { friction, restitution } = resolveColliderMaterial({
        ...options,
      } as Physics3DColliderOptions);
      const isSensor = options?.isSensor ?? false;
      const membership = resolveLayerBits(options?.layers, ctx.layerRegistry);
      const filter = resolveLayerBits(options?.mask, ctx.layerRegistry);

      // Rust first: a rejected rebuild leaves the registry geometry as it was.
      const rebuilt = callPhysics3DExport(
        ctx,
        "physics3d_rebuild_mesh_collider",
        () =>
          ctx.wasmBridge!.physics3d_rebuild_mesh_collider?.(
            slot,
            colliderId,
            vertices,
            indices,
            0,
            0,
            0,
            isSensor,
            friction,
            restitution,
            membership,
            filter,
          ) ?? false,
      );
      if (!rebuilt) return false;
    }

    if (entry && entry.shape.type === "mesh") {
      entry.shape.vertices = vertices;
      entry.shape.indices = indices;
    }
    return true;
  };
}

// ─── Bulk spawn static boxes ───────────────────────────────────────────────────

export function createBulkSpawnStaticBoxes(
  ctx: PluginContext,
): (options: BulkStaticBoxesOptions) => BulkStaticBoxesResult {
  return (options) => {
    if (options.positions.length % 3 !== 0) {
      throw new GwenError(
        Physics3DErrorCodes.INVALID_MESH_BUFFER,
        `positions.length must be a multiple of 3, got ${options.positions.length}.`,
        {},
      );
    }
    const n = options.positions.length / 3;
    const friction = options.friction ?? 0.5;
    const restitution = options.restitution ?? 0.0;
    const membership = resolveLayerBits(options.layers, ctx.layerRegistry);
    const filter = resolveLayerBits(options.mask, ctx.layerRegistry);

    const entityIds: EntityId[] = [];
    const entityIndices = new Uint32Array(n);
    const wasmBulk =
      ctx.backendMode === "wasm" && ctx.wasmBridge!.physics3d_bulk_spawn_static_boxes;

    let spawned = 0;
    try {
      for (let i = 0; i < n; i++) {
        const eid = ctx._engine!.createEntity();
        entityIds.push(eid);
        entityIndices[i] = entityIndex(eid);
      }

      if (wasmBulk) {
        spawned = callPhysics3DExport(ctx, "physics3d_bulk_spawn_static_boxes", () =>
          ctx.wasmBridge!.physics3d_bulk_spawn_static_boxes!(
            entityIndices,
            options.positions,
            options.halfExtents,
            friction,
            restitution,
            membership,
            filter,
          ),
        );
      }
    } catch (err: unknown) {
      // Rust wrote nothing. Release the entities created for this call.
      for (const eid of entityIds) ctx._engine!.destroyEntity(eid);
      throw err;
    }

    if (wasmBulk) {
      for (let i = 0; i < spawned; i++) {
        const spawnedId = entityIds[i];
        const slot = entityIndices[i];
        if (spawnedId === undefined || slot === undefined) continue;
        const handle: Physics3DBodyHandle = {
          bodyId: ctx.nextBodyId++,
          entityId: spawnedId,
          kind: "fixed",
          mass: 0,
          linearDamping: 0,
          angularDamping: 0,
        };
        ctx.bodyByEntity.set(slot, handle);
        noteOwnerChange(ctx, slot);
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

      const localId = entityIds[i];
      if (localId === undefined) continue;
      const collider: Physics3DColliderOptions = {
        shape: { type: "box", halfX: hx, halfY: hy, halfZ: hz },
        friction,
        restitution,
        ...(options.layers !== undefined ? { layers: options.layers } : {}),
        ...(options.mask !== undefined ? { mask: options.mask } : {}),
      };
      createBodyLocal(ctx, localId, {
        kind: "fixed",
        initialPosition: { x: px, y: py, z: pz },
        colliders: [collider],
      });
    }
    return { entityIds, count: n };
  };
}

// ─── Compound collider ─────────────────────────────────────────────────────────

export function createAddCompoundCollider(ctx: PluginContext): Physics3DAPI["addCompoundCollider"] {
  const removeCollider = createRemoveCollider(ctx);

  return (entityId, options) => {
    const owned = guardOwned(ctx, entityId, "addCompoundCollider");
    if (!owned) return null;
    const slot = owned.slot;

    const { shapes, layers, mask } = options;
    const colliderIds = shapes.map(() => nextColliderId());

    if (ctx.backendMode === "wasm" && ctx.wasmBridge?.physics3d_add_compound_collider) {
      const layerBits = resolveLayerBits(layers, ctx.layerRegistry);
      const maskBits = resolveLayerBits(mask, ctx.layerRegistry);
      const buf = encodeCompoundShapes(shapes, colliderIds);
      // Rust inserts every part or throws (INVALID_COMPOUND, COLLIDER_ALREADY_EXISTS, ...).
      const count = callPhysics3DExport(ctx, "physics3d_add_compound_collider", () =>
        ctx.wasmBridge!.physics3d_add_compound_collider!(slot, buf, layerBits, maskBits),
      );

      if (count !== shapes.length) {
        throw new GwenError(
          Physics3DErrorCodes.INVALID_COMPOUND,
          `physics3d_add_compound_collider inserted ${count} of ${shapes.length} shapes.`,
          {},
        );
      }

      if (!ctx.localColliders.has(slot)) ctx.localColliders.set(slot, []);
      shapes.forEach((shape, i) => {
        ctx.localColliders
          .get(slot)!
          .push(shapeSpecToColliderOptions(shape, colliderIds[i]!, layers, mask));
      });
    } else {
      shapes.forEach((shape, i) => {
        addColliderImpl(
          ctx,
          entityId,
          shapeSpecToColliderOptions(shape, colliderIds[i]!, layers, mask),
        );
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

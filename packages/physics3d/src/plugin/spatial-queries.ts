/**
 * @fileoverview Spatial queries: raycast, shape-cast, overlap, point projection.
 *
 * Includes both imperative one-shot queries and persistent slot registration.
 */

import type { EntityId } from '@gwenjs/core';
import type {
  Physics3DAPI,
  Physics3DVec3,
  Physics3DQuat,
  Physics3DColliderShape,
  RayHit,
  ShapeHit,
  PointProjection,
  RaycastOpts,
  RaycastHandle,
  RaycastSlotResult,
  ShapeCastOpts,
  ShapeCastHandle,
  ShapeCastSlotResult,
  OverlapOpts,
  OverlapHandle,
  OverlapSlotResult,
} from '../types';
import { entityIndexToId, encodeShape, u32ToF32 } from './plugin-helpers';
import type { PluginContext } from './plugin-context';

export function createSpatialQueryMethods(ctx: PluginContext): Pick<
  Physics3DAPI,
  | 'castRay'
  | 'castShape'
  | 'overlapShape'
  | 'projectPoint'
  | 'registerRaycastSlot'
  | 'unregisterRaycastSlot'
  | 'registerShapeCastSlot'
  | 'unregisterShapeCastSlot'
  | 'registerOverlapSlot'
  | 'unregisterOverlapSlot'
> {
  return {
    // ─── Imperative queries ──────────────────────────────────────────────────

    castRay(
      origin: Physics3DVec3,
      direction: Physics3DVec3,
      maxDist: number,
      opts: { layers?: number; mask?: number; solid?: boolean } = {},
    ): RayHit | null {
      if (ctx.backendMode === 'wasm') {
        const { layers = 0xffffffff, mask = 0xffffffff, solid = true } = opts;
        const result = ctx.wasmBridge!.physics3d_cast_ray?.(
          origin.x, origin.y, origin.z,
          direction.x, direction.y, direction.z,
          maxDist,
          layers, mask,
          solid ? 1 : 0,
        );
        if (!result || result.length < 9 || result[0] === 0) return null;
        const entityIndex = result[1] as number;
        return {
          entity: entityIndexToId(ctx, entityIndex),
          distance: result[2]!,
          normal: { x: result[3]!, y: result[4]!, z: result[5]! },
          point: { x: result[6]!, y: result[7]!, z: result[8]! },
        };
      }
      if (import.meta.env.DEV) {
        console.warn('[GWEN:physics3d] castRay() not available in local mode');
      }
      return null;
    },

    castShape(
      pos: Physics3DVec3,
      rot: Physics3DQuat,
      dir: Physics3DVec3,
      shape: Physics3DColliderShape,
      maxDist: number,
      opts: { layers?: number; mask?: number } = {},
    ): ShapeHit | null {
      if (ctx.backendMode === 'wasm') {
        const { layers = 0xffffffff, mask = 0xffffffff } = opts;
        const [shapeType, p0, p1, p2] = encodeShape(shape);
        const result = ctx.wasmBridge!.physics3d_cast_shape?.(
          pos.x, pos.y, pos.z,
          rot.x, rot.y, rot.z, rot.w,
          dir.x, dir.y, dir.z,
          shapeType, p0, p1, p2,
          maxDist,
          layers, mask,
        );
        if (!result || result.length < 15 || result[0] === 0) return null;
        const entityIndex = result[1] as number;
        return {
          entity: entityIndexToId(ctx, entityIndex),
          distance: result[2]!,
          normal: { x: result[3]!, y: result[4]!, z: result[5]! },
          point: { x: result[6]!, y: result[7]!, z: result[8]! },
          witnessA: { x: result[9]!, y: result[10]!, z: result[11]! },
          witnessB: { x: result[12]!, y: result[13]!, z: result[14]! },
        };
      }
      if (import.meta.env.DEV) {
        console.warn('[GWEN:physics3d] castShape() not available in local mode');
      }
      return null;
    },

    overlapShape(
      pos: Physics3DVec3,
      rot: Physics3DQuat,
      shape: Physics3DColliderShape,
      opts: { layers?: number; mask?: number; maxResults?: number } = {},
    ): EntityId[] {
      if (ctx.backendMode === 'wasm') {
        const {
          layers = 0xffffffff,
          mask = 0xffffffff,
          maxResults = ctx.MAX_COMPOSABLE_OVERLAP_RESULTS,
        } = opts;
        const wasmMem = ctx.bridgeRuntime?.getLinearMemory?.();
        if (!wasmMem || !ctx.overlapScratchView || ctx.overlapScratchPtr === 0) {
          if (import.meta.env.DEV) {
            console.warn('[GWEN:physics3d] overlapShape() scratch buffer unavailable');
          }
          return [];
        }
        const [shapeType, p0, p1, p2] = encodeShape(shape);
        const safeMax = Math.min(maxResults, ctx.MAX_COMPOSABLE_OVERLAP_RESULTS);

        const scratchView = new Uint32Array(
          wasmMem.buffer,
          ctx.overlapScratchPtr,
          ctx.MAX_COMPOSABLE_OVERLAP_RESULTS,
        );
        const count =
          ctx.wasmBridge!.physics3d_overlap_shape?.(
            pos.x, pos.y, pos.z,
            rot.x, rot.y, rot.z, rot.w,
            shapeType, p0, p1, p2,
            layers, mask,
            ctx.overlapScratchPtr,
            safeMax,
          ) ?? 0;

        const entities: EntityId[] = [];
        for (let i = 0; i < count; i++) {
          entities.push(entityIndexToId(ctx, scratchView[i]!));
        }
        return entities;
      }
      if (import.meta.env.DEV) {
        console.warn('[GWEN:physics3d] overlapShape() not available in local mode');
      }
      return [];
    },

    projectPoint(
      point: Physics3DVec3,
      opts: { layers?: number; mask?: number; solid?: boolean } = {},
    ): PointProjection | null {
      if (ctx.backendMode === 'wasm') {
        const { layers = 0xffffffff, mask = 0xffffffff, solid = true } = opts;
        const result = ctx.wasmBridge!.physics3d_project_point?.(
          point.x, point.y, point.z,
          layers, mask,
          solid ? 1 : 0,
        );
        if (!result || result.length < 6 || result[0] === 0) return null;
        const entityIndex = result[1] as number;
        return {
          entity: entityIndexToId(ctx, entityIndex),
          point: { x: result[2]!, y: result[3]!, z: result[4]! },
          isInside: result[5] !== 0,
        };
      }
      if (import.meta.env.DEV) {
        console.warn('[GWEN:physics3d] projectPoint() not available in local mode');
      }
      return null;
    },

    // ─── Slot registration ───────────────────────────────────────────────────

    registerRaycastSlot(opts: RaycastOpts, staticSlotIdx?: number): RaycastHandle {
      const id = staticSlotIdx ?? ctx.nextRaycastSlotId++;
      if (ctx.raycastSlots.size >= ctx.MAX_RAYCAST_SLOTS) {
        console.warn(`[GWEN:physics3d] Maximum raycast slot count (${ctx.MAX_RAYCAST_SLOTS}) reached`);
      }
      const result: RaycastSlotResult = {
        hit: false,
        entity: 0n as EntityId,
        distance: 0,
        normal: { x: 0, y: 0, z: 0 },
        point: { x: 0, y: 0, z: 0 },
      };
      const handle: RaycastHandle = {
        get hit() { return result.hit; },
        get entity() { return result.entity; },
        get distance() { return result.distance; },
        get normal() { return result.normal; },
        get point() { return result.point; },
        _id: id,
      };
      ctx.raycastSlots.set(id, {
        opts,
        result,
        _si: new Float32Array([
          opts.direction.x,
          opts.direction.y,
          opts.direction.z,
          opts.maxDist ?? 100,
          u32ToF32(ctx, opts.layers ?? 0xffffffff),
          u32ToF32(ctx, opts.mask ?? 0xffffffff),
          (opts.solid ?? true) ? 1.0 : 0.0,
        ]),
      });
      if (staticSlotIdx !== undefined && ctx.backendMode === 'wasm' && ctx.wasmBridge) {
        const slotPtr = ctx._raycastOutputSABPtr + staticSlotIdx * 9 * 4;
        ctx.wasmBridge.physics3d_add_raycast_slot?.(
          slotPtr,
          0, 0, 0,
          opts.direction.x, opts.direction.y, opts.direction.z,
          opts.maxDist ?? 100,
          opts.layers ?? 0xffffffff,
          opts.mask ?? 0xffffffff,
          opts.solid ?? true,
        );
      }
      return handle;
    },

    unregisterRaycastSlot(handle: RaycastHandle): void {
      ctx.raycastSlots.delete(handle._id);
    },

    registerShapeCastSlot(opts: ShapeCastOpts, staticSlotIdx?: number): ShapeCastHandle {
      const id = staticSlotIdx ?? ctx.nextShapeCastSlotId++;
      if (ctx.shapeCastSlots.size >= ctx.MAX_SHAPECAST_SLOTS) {
        console.warn(
          `[GWEN:physics3d] Maximum shape cast slot count (${ctx.MAX_SHAPECAST_SLOTS}) reached`,
        );
      }
      const result: ShapeCastSlotResult = {
        hit: false,
        entity: 0n as EntityId,
        distance: 0,
        normal: { x: 0, y: 0, z: 0 },
        point: { x: 0, y: 0, z: 0 },
        witnessA: { x: 0, y: 0, z: 0 },
        witnessB: { x: 0, y: 0, z: 0 },
      };
      const handle: ShapeCastHandle = {
        get hit() { return result.hit; },
        get entity() { return result.entity; },
        get distance() { return result.distance; },
        get normal() { return result.normal; },
        get point() { return result.point; },
        get witnessA() { return result.witnessA; },
        get witnessB() { return result.witnessB; },
        _id: id,
      };
      const [shapeType, p0, p1, p2] = encodeShape(opts.shape);
      ctx.shapeCastSlots.set(id, {
        opts,
        result,
        _si: new Float32Array([
          opts.direction.x,
          opts.direction.y,
          opts.direction.z,
          shapeType, p0, p1, p2,
          opts.maxDist ?? 100,
          u32ToF32(ctx, opts.layers ?? 0xffffffff),
          u32ToF32(ctx, opts.mask ?? 0xffffffff),
        ]),
      });
      if (staticSlotIdx !== undefined && ctx.backendMode === 'wasm' && ctx.wasmBridge) {
        const slotPtr = ctx._shapecastOutputSABPtr + staticSlotIdx * 15 * 4;
        const origin = opts.origin?.() ?? ctx.ZERO_VEC3;
        const rotation = opts.rotation?.() ?? { x: 0, y: 0, z: 0, w: 1 };
        ctx.wasmBridge.physics3d_add_shapecast_slot?.(
          slotPtr,
          shapeType, p0, p1, p2,
          origin.x, origin.y, origin.z,
          rotation.x, rotation.y, rotation.z, rotation.w,
          opts.direction.x, opts.direction.y, opts.direction.z,
          opts.maxDist ?? 100,
          opts.layers ?? 0xffffffff,
          opts.mask ?? 0xffffffff,
        );
      }
      return handle;
    },

    unregisterShapeCastSlot(handle: ShapeCastHandle): void {
      ctx.shapeCastSlots.delete(handle._id);
    },

    registerOverlapSlot(opts: OverlapOpts, staticSlotIdx?: number): OverlapHandle {
      const id = staticSlotIdx ?? ctx.nextOverlapSlotId++;
      if (ctx.overlapSlots.size >= ctx.MAX_OVERLAP_SLOTS) {
        console.warn(`[GWEN:physics3d] Maximum overlap slot count (${ctx.MAX_OVERLAP_SLOTS}) reached`);
      }
      const result: OverlapSlotResult = { count: 0, entities: [] };
      const handle: OverlapHandle = {
        get count() { return result.count; },
        get entities() { return result.entities; },
        _id: id,
      };
      const [shapeType, p0, p1, p2] = encodeShape(opts.shape);
      ctx.overlapSlots.set(id, {
        opts,
        result,
        _si: new Float32Array([
          shapeType, p0, p1, p2,
          opts.maxResults ?? ctx.MAX_COMPOSABLE_OVERLAP_RESULTS,
        ]),
      });
      if (staticSlotIdx !== undefined && ctx.backendMode === 'wasm' && ctx.wasmBridge) {
        const ovStride = ctx.MAX_COMPOSABLE_OVERLAP_RESULTS + 1;
        const slotPtr = ctx._overlapOutputSABPtr + staticSlotIdx * ovStride * 4;
        const origin = opts.origin();
        const rotation = opts.rotation?.() ?? { x: 0, y: 0, z: 0, w: 1 };
        ctx.wasmBridge.physics3d_add_overlap_slot?.(
          slotPtr,
          shapeType, p0, p1, p2,
          origin.x, origin.y, origin.z,
          rotation.x, rotation.y, rotation.z, rotation.w,
          opts.layers ?? 0xffffffff,
          opts.mask ?? 0xffffffff,
          opts.maxResults ?? ctx.MAX_COMPOSABLE_OVERLAP_RESULTS,
        );
      }
      return handle;
    },

    unregisterOverlapSlot(handle: OverlapHandle): void {
      ctx.overlapSlots.delete(handle._id);
    },
  };
}

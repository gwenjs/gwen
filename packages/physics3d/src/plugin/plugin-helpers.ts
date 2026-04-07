/**
 * @fileoverview Shared helper functions used by multiple Physics3D sub-modules.
 *
 * These helpers depend on the PluginContext for WASM bridge and runtime access.
 */

import { createEntityId } from "@gwenjs/core";
import type { EntityId, GwenLogger } from "@gwenjs/core";
import type { Physics3DColliderShape, JointHandle3D } from "../types";
import type { PluginContext } from "./plugin-context";

/**
 * Emit a one-time warning that a joint operation is unavailable in local mode.
 */
export const emitLocalJointWarning = (log: GwenLogger): void => {
  if (import.meta.env.DEV) {
    log.warn("Joint API requires WASM physics3d variant — not available in local mode");
  }
};

/**
 * Create a no-op dummy joint handle for use in local mode or WASM failure paths.
 */
export const makeDummyJoint = (): JointHandle3D => 0xffffffff;

/**
 * Wrap a WASM numeric joint id in a {@link JointHandle3D}.
 */
export const makeJointHandle = (id: number): JointHandle3D => id;

/**
 * Convert a raw entity slot index back to a typed `EntityId`.
 *
 * Uses `bridgeRuntime.getEntityGeneration` when available so the returned id
 * carries the correct generation bits.
 */
export const entityIndexToId = (ctx: PluginContext, index: number): EntityId => {
  if (ctx.bridgeRuntime?.getEntityGeneration) {
    const gen = ctx.bridgeRuntime.getEntityGeneration(index);
    if (gen !== undefined) return createEntityId(index, gen);
  }
  return BigInt(index) as EntityId;
};

/**
 * Bit-cast an unsigned 32-bit integer to its IEEE-754 float32 representation.
 */
export const u32ToF32 = (ctx: PluginContext, val: number): number => {
  ctx._castU32[0] = val >>> 0;
  return ctx._castF32[0]!;
};

/**
 * Encode a {@link Physics3DColliderShape} into the 4-float tuple expected by
 * WASM spatial query functions: `[shapeType, p0, p1, p2]`.
 */
export const encodeShape = (shape: Physics3DColliderShape): [number, number, number, number] => {
  switch (shape.type) {
    case "box":
      return [0, shape.halfX, shape.halfY, shape.halfZ];
    case "sphere":
      return [1, shape.radius, 0, 0];
    case "capsule":
      return [2, shape.radius, shape.halfHeight, 0];
    default:
      // Mesh, convex, heightfield: not supported for spatial queries — fall back to unit sphere
      return [1, 0.5, 0, 0];
  }
};

/**
 * Generate the next stable collider id for an entity.
 */
export const nextColliderIdForEntity = (ctx: PluginContext, entityId: number): number => {
  const existing = ctx.localColliders.get(entityId);
  return existing ? existing.length : 0;
};

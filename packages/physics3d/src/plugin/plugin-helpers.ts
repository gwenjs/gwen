/**
 * @fileoverview Shared helper functions used by multiple Physics3D sub-modules.
 *
 * These helpers depend on the PluginContext for WASM bridge and runtime access.
 */

import type { EntityId } from "@gwenjs/core";
import { ownerEntityId } from "./entity-owner";
import type { IGwenLogger as GwenLogger } from "@gwenjs/schema";
import type { Physics3DColliderShape, JointHandle3D } from "../types";
import type { PluginContext } from "./plugin-context";

/**
 * Emit a one-time warning that a joint operation is unavailable in local mode.
 */
export const emitLocalJointWarning = (log: GwenLogger): void => {
  if (__GWEN_DEV__) {
    log.warn("Joint API requires WASM physics3d variant — not available in local mode");
  }
};

/** A live id reached a joint call without a body. This is not a local-mode limit. */
export const emitMissingBodyWarning = (log: GwenLogger): void => {
  if (__GWEN_DEV__) {
    log.warn("Joint API: no body for bodyA/bodyB");
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
 * Resolve a slot to the engine id that owns its body.
 * Returns undefined when the slot has no owner or the owner changed since the last step.
 * Never reads the WASM entity allocator.
 */
export const entityIndexToId = (ctx: PluginContext, index: number): EntityId | undefined => {
  return ownerEntityId(ctx, index);
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

/**
 * @fileoverview Joint (constraint) creation and management.
 *
 * Supports fixed, revolute, prismatic, ball, and spring joints.
 */

import type {
  Physics3DAPI,
  Physics3DEntityId,
  FixedJointOpts,
  RevoluteJointOpts,
  PrismaticJointOpts,
  BallJointOpts,
  SpringJointOpts,
  JointHandle3D,
  JointId,
} from "../types";
import { guardOwned } from "./entity-owner";
import {
  emitLocalJointWarning,
  emitMissingBodyWarning,
  makeDummyJoint,
  makeJointHandle,
} from "./plugin-helpers";
import type { PluginContext } from "./plugin-context";
import { Physics3DErrorCodes } from "../errors/codes";
import { callPhysics3DExport, hasPhysics3DCode } from "./wasm-errors";

/** Both ends must own their slots. A dead id throws. An unowned live id yields null. */
function jointEnds(
  ctx: PluginContext,
  operation: string,
  bodyA: Physics3DEntityId,
  bodyB: Physics3DEntityId,
): { slotA: number; slotB: number } | null {
  const a = guardOwned(ctx, bodyA, operation);
  const b = guardOwned(ctx, bodyB, operation);
  if (!a || !b) return null;
  return { slotA: a.slot, slotB: b.slot };
}

/**
 * Create one joint in Rust. An absent export is the local-mode answer (warning, dummy joint).
 * A rejected call throws `GwenWasmError`; there is no sentinel id.
 */
function wasmJointHandle(
  ctx: PluginContext,
  exportName: string,
  create: () => number | undefined,
): JointHandle3D {
  const id = callPhysics3DExport(ctx, exportName, create);
  if (id === undefined) {
    emitLocalJointWarning(ctx.log);
    return makeDummyJoint();
  }
  return makeJointHandle(id);
}

export function createJointMethods(
  ctx: PluginContext,
): Pick<
  Physics3DAPI,
  | "addFixedJoint"
  | "addRevoluteJoint"
  | "addPrismaticJoint"
  | "addBallJoint"
  | "addSpringJoint"
  | "removeJoint"
  | "setJointMotorVelocity"
  | "setJointMotorPosition"
  | "setJointEnabled"
> {
  return {
    addFixedJoint(opts: FixedJointOpts): JointHandle3D {
      const ends = jointEnds(ctx, "addFixedJoint", opts.bodyA, opts.bodyB);
      if (!ends) {
        emitMissingBodyWarning(ctx.log);
        return makeDummyJoint();
      }
      const { slotA, slotB } = ends;
      const a = opts.anchorA ?? {};
      const b = opts.anchorB ?? {};

      if (ctx.backendMode === "wasm") {
        // Rust rejects a missing body or a non-finite value: the typed error propagates.
        return wasmJointHandle(ctx, "physics3d_add_fixed_joint", () =>
          ctx.wasmBridge!.physics3d_add_fixed_joint?.(
            slotA,
            slotB,
            a.x ?? 0,
            a.y ?? 0,
            a.z ?? 0,
            b.x ?? 0,
            b.y ?? 0,
            b.z ?? 0,
          ),
        );
      }

      emitLocalJointWarning(ctx.log);
      return makeDummyJoint();
    },

    addRevoluteJoint(opts: RevoluteJointOpts): JointHandle3D {
      const ends = jointEnds(ctx, "addRevoluteJoint", opts.bodyA, opts.bodyB);
      if (!ends) {
        emitMissingBodyWarning(ctx.log);
        return makeDummyJoint();
      }
      const { slotA, slotB } = ends;
      const a = opts.anchorA ?? {};
      const b = opts.anchorB ?? {};
      const axis = opts.axis ?? {};
      const useLimits = opts.limits !== undefined;
      const limitMin = opts.limits?.[0] ?? 0;
      const limitMax = opts.limits?.[1] ?? 0;

      if (ctx.backendMode === "wasm") {
        // Rust rejects a missing body or a non-finite value: the typed error propagates.
        return wasmJointHandle(ctx, "physics3d_add_revolute_joint", () =>
          ctx.wasmBridge!.physics3d_add_revolute_joint?.(
            slotA,
            slotB,
            a.x ?? 0,
            a.y ?? 0,
            a.z ?? 0,
            b.x ?? 0,
            b.y ?? 0,
            b.z ?? 0,
            axis.x ?? 0,
            axis.y ?? 1,
            axis.z ?? 0,
            useLimits,
            limitMin,
            limitMax,
          ),
        );
      }

      emitLocalJointWarning(ctx.log);
      return makeDummyJoint();
    },

    addPrismaticJoint(opts: PrismaticJointOpts): JointHandle3D {
      const ends = jointEnds(ctx, "addPrismaticJoint", opts.bodyA, opts.bodyB);
      if (!ends) {
        emitMissingBodyWarning(ctx.log);
        return makeDummyJoint();
      }
      const { slotA, slotB } = ends;
      const a = opts.anchorA ?? {};
      const b = opts.anchorB ?? {};
      const axis = opts.axis ?? {};
      const useLimits = opts.limits !== undefined;
      const limitMin = opts.limits?.[0] ?? 0;
      const limitMax = opts.limits?.[1] ?? 0;

      if (ctx.backendMode === "wasm") {
        // Rust rejects a missing body or a non-finite value: the typed error propagates.
        return wasmJointHandle(ctx, "physics3d_add_prismatic_joint", () =>
          ctx.wasmBridge!.physics3d_add_prismatic_joint?.(
            slotA,
            slotB,
            a.x ?? 0,
            a.y ?? 0,
            a.z ?? 0,
            b.x ?? 0,
            b.y ?? 0,
            b.z ?? 0,
            axis.x ?? 0,
            axis.y ?? 1,
            axis.z ?? 0,
            useLimits,
            limitMin,
            limitMax,
          ),
        );
      }

      emitLocalJointWarning(ctx.log);
      return makeDummyJoint();
    },

    addBallJoint(opts: BallJointOpts): JointHandle3D {
      const ends = jointEnds(ctx, "addBallJoint", opts.bodyA, opts.bodyB);
      if (!ends) {
        emitMissingBodyWarning(ctx.log);
        return makeDummyJoint();
      }
      const { slotA, slotB } = ends;
      const a = opts.anchorA ?? {};
      const b = opts.anchorB ?? {};
      const useConeLimit = opts.coneAngle !== undefined;
      const coneAngle = opts.coneAngle ?? 0;

      if (ctx.backendMode === "wasm") {
        // Rust rejects a missing body or a non-finite value: the typed error propagates.
        return wasmJointHandle(ctx, "physics3d_add_ball_joint", () =>
          ctx.wasmBridge!.physics3d_add_ball_joint?.(
            slotA,
            slotB,
            a.x ?? 0,
            a.y ?? 0,
            a.z ?? 0,
            b.x ?? 0,
            b.y ?? 0,
            b.z ?? 0,
            useConeLimit,
            coneAngle,
          ),
        );
      }

      emitLocalJointWarning(ctx.log);
      return makeDummyJoint();
    },

    addSpringJoint(opts: SpringJointOpts): JointHandle3D {
      const ends = jointEnds(ctx, "addSpringJoint", opts.bodyA, opts.bodyB);
      if (!ends) {
        emitMissingBodyWarning(ctx.log);
        return makeDummyJoint();
      }
      const { slotA, slotB } = ends;
      const a = opts.anchorA ?? {};
      const b = opts.anchorB ?? {};

      if (ctx.backendMode === "wasm") {
        // Rust rejects a missing body or a non-finite value: the typed error propagates.
        return wasmJointHandle(ctx, "physics3d_add_spring_joint", () =>
          ctx.wasmBridge!.physics3d_add_spring_joint?.(
            slotA,
            slotB,
            a.x ?? 0,
            a.y ?? 0,
            a.z ?? 0,
            b.x ?? 0,
            b.y ?? 0,
            b.z ?? 0,
            opts.restLength,
            opts.stiffness,
            opts.damping,
          ),
        );
      }

      emitLocalJointWarning(ctx.log);
      return makeDummyJoint();
    },

    removeJoint(id: JointId): void {
      if (ctx.backendMode !== "wasm") return;
      // Idempotent. Rust removes a joint together with either of its bodies, so a TypeScript
      // id registry would go stale. A joint that is already gone satisfies the call.
      try {
        callPhysics3DExport(ctx, "physics3d_remove_joint", () =>
          ctx.wasmBridge!.physics3d_remove_joint?.(id as number),
        );
      } catch (err: unknown) {
        if (hasPhysics3DCode(err, Physics3DErrorCodes.JOINT_NOT_FOUND)) return;
        throw err;
      }
    },

    setJointMotorVelocity(id: JointId, velocity: number, maxForce: number): void {
      if (ctx.backendMode !== "wasm") return;
      callPhysics3DExport(ctx, "physics3d_set_joint_motor_velocity", () =>
        ctx.wasmBridge!.physics3d_set_joint_motor_velocity?.(id as number, velocity, maxForce),
      );
    },

    setJointMotorPosition(id: JointId, target: number, stiffness: number, damping: number): void {
      if (ctx.backendMode !== "wasm") return;
      callPhysics3DExport(ctx, "physics3d_set_joint_motor_position", () =>
        ctx.wasmBridge!.physics3d_set_joint_motor_position?.(
          id as number,
          target,
          stiffness,
          damping,
        ),
      );
    },

    setJointEnabled(id: JointId, enabled: boolean): void {
      if (ctx.backendMode !== "wasm") return;
      callPhysics3DExport(ctx, "physics3d_set_joint_enabled", () =>
        ctx.wasmBridge!.physics3d_set_joint_enabled?.(id as number, enabled),
      );
    },
  };
}

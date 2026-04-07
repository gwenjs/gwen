/**
 * @fileoverview Continuous forces, gravity scale, axis locks, and sleep control.
 */

import type { EntityId } from "@gwenjs/core";
import type { Physics3DAPI, Physics3DEntityId, Physics3DVec3 } from "../types";
import { toEntityIndex } from "./physics3d-utils";
import type { PluginContext } from "./plugin-context";

export function createForcesAndConstraints(
  ctx: PluginContext,
): Pick<
  Physics3DAPI,
  | "addForce"
  | "addTorque"
  | "addForceAtPoint"
  | "setGravityScale"
  | "getGravityScale"
  | "lockTranslations"
  | "lockRotations"
  | "setBodySleeping"
  | "isBodySleeping"
  | "wakeAll"
> {
  return {
    addForce(entityId: Physics3DEntityId, force: Partial<Physics3DVec3>): void {
      const slot = toEntityIndex(entityId as EntityId);
      if (ctx.backendMode === "wasm") {
        ctx.wasmBridge!.physics3d_add_force?.(slot, force.x ?? 0, force.y ?? 0, force.z ?? 0);
        return;
      }
      const acc = ctx.localForces.get(slot) ?? { x: 0, y: 0, z: 0 };
      ctx.localForces.set(slot, {
        x: acc.x + (force.x ?? 0),
        y: acc.y + (force.y ?? 0),
        z: acc.z + (force.z ?? 0),
      });
    },

    addTorque(entityId: Physics3DEntityId, torque: Partial<Physics3DVec3>): void {
      const slot = toEntityIndex(entityId as EntityId);
      if (ctx.backendMode === "wasm") {
        ctx.wasmBridge!.physics3d_add_torque?.(slot, torque.x ?? 0, torque.y ?? 0, torque.z ?? 0);
        return;
      }
      const acc = ctx.localTorques.get(slot) ?? { x: 0, y: 0, z: 0 };
      ctx.localTorques.set(slot, {
        x: acc.x + (torque.x ?? 0),
        y: acc.y + (torque.y ?? 0),
        z: acc.z + (torque.z ?? 0),
      });
    },

    addForceAtPoint(
      entityId: Physics3DEntityId,
      force: Partial<Physics3DVec3>,
      point: Partial<Physics3DVec3>,
    ): void {
      const slot = toEntityIndex(entityId as EntityId);
      if (ctx.backendMode === "wasm") {
        ctx.wasmBridge!.physics3d_add_force_at_point?.(
          slot,
          force.x ?? 0,
          force.y ?? 0,
          force.z ?? 0,
          point.x ?? 0,
          point.y ?? 0,
          point.z ?? 0,
        );
        return;
      }
      const acc = ctx.localForces.get(slot) ?? { x: 0, y: 0, z: 0 };
      ctx.localForces.set(slot, {
        x: acc.x + (force.x ?? 0),
        y: acc.y + (force.y ?? 0),
        z: acc.z + (force.z ?? 0),
      });
    },

    setGravityScale(entityId: Physics3DEntityId, scale: number): void {
      const slot = toEntityIndex(entityId as EntityId);
      if (ctx.backendMode === "wasm") {
        ctx.wasmBridge!.physics3d_set_gravity_scale?.(slot, scale);
        return;
      }
      ctx.localGravityScales.set(slot, scale);
    },

    getGravityScale(entityId: Physics3DEntityId): number {
      const slot = toEntityIndex(entityId as EntityId);
      if (ctx.backendMode === "wasm") {
        return ctx.wasmBridge!.physics3d_get_gravity_scale?.(slot) ?? 1.0;
      }
      return ctx.localGravityScales.get(slot) ?? 1.0;
    },

    lockTranslations(entityId: Physics3DEntityId, x: boolean, y: boolean, z: boolean): void {
      const slot = toEntityIndex(entityId as EntityId);
      if (ctx.backendMode === "wasm") {
        ctx.wasmBridge!.physics3d_lock_translations?.(slot, x, y, z);
        return;
      }
      const cur = ctx.localAxisLocks.get(slot) ?? {
        tx: false,
        ty: false,
        tz: false,
        rx: false,
        ry: false,
        rz: false,
      };
      ctx.localAxisLocks.set(slot, {
        ...cur,
        tx: x || cur.tx,
        ty: y || cur.ty,
        tz: z || cur.tz,
      });
    },

    lockRotations(entityId: Physics3DEntityId, x: boolean, y: boolean, z: boolean): void {
      const slot = toEntityIndex(entityId as EntityId);
      if (ctx.backendMode === "wasm") {
        ctx.wasmBridge!.physics3d_lock_rotations?.(slot, x, y, z);
        return;
      }
      const cur = ctx.localAxisLocks.get(slot) ?? {
        tx: false,
        ty: false,
        tz: false,
        rx: false,
        ry: false,
        rz: false,
      };
      ctx.localAxisLocks.set(slot, {
        ...cur,
        rx: x || cur.rx,
        ry: y || cur.ry,
        rz: z || cur.rz,
      });
    },

    setBodySleeping(entityId: Physics3DEntityId, sleeping: boolean): void {
      const slot = toEntityIndex(entityId as EntityId);
      if (ctx.backendMode === "wasm") {
        ctx.wasmBridge!.physics3d_set_body_sleeping?.(slot, sleeping);
        return;
      }
      if (sleeping) {
        ctx.localSleeping.add(slot);
      } else {
        ctx.localSleeping.delete(slot);
      }
    },

    isBodySleeping(entityId: Physics3DEntityId): boolean {
      const slot = toEntityIndex(entityId as EntityId);
      if (ctx.backendMode === "wasm") {
        return ctx.wasmBridge!.physics3d_is_body_sleeping?.(slot) ?? false;
      }
      return ctx.localSleeping.has(slot);
    },

    wakeAll(): void {
      if (ctx.backendMode === "wasm") {
        ctx.wasmBridge!.physics3d_wake_all?.();
        return;
      }
      ctx.localSleeping.clear();
    },
  };
}

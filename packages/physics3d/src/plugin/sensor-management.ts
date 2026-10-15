/**
 * @fileoverview Sensor state querying and updating.
 */

import type { Physics3DAPI } from "../types";
import { guardOwned } from "./entity-owner";
import type { PluginContext } from "./plugin-context";
import { callPhysics3DExport } from "./wasm-errors";

const COUNT_MASK = 0xffffffffn;
const ACTIVE_BIT = 1n << 32n;

export function createGetSensorState(ctx: PluginContext): Physics3DAPI["getSensorState"] {
  return (entityId, sensorId) => {
    const owned = guardOwned(ctx, entityId, "getSensorState");
    if (!owned) return { contactCount: 0, isActive: false };
    const slot = owned.slot;
    if (ctx.backendMode === "wasm" && ctx.wasmBridge!.physics3d_get_sensor_state) {
      // Packed by Rust: bits 0-31 are the contact count, bit 32 is the active flag.
      // `0n` is a registered body with no recorded state, not a failure.
      const raw = callPhysics3DExport(ctx, "physics3d_get_sensor_state", () =>
        ctx.wasmBridge!.physics3d_get_sensor_state!(slot, sensorId),
      );
      const contactCount = Number(raw & COUNT_MASK);
      const isActive = (raw & ACTIVE_BIT) !== 0n;
      let sensorMap = ctx.localSensorStates.get(slot);
      if (!sensorMap) {
        sensorMap = new Map();
        ctx.localSensorStates.set(slot, sensorMap);
      }
      sensorMap.set(sensorId, { contactCount, isActive });
      return { contactCount, isActive };
    }
    return ctx.localSensorStates.get(slot)?.get(sensorId) ?? { contactCount: 0, isActive: false };
  };
}

export function createUpdateSensorState(ctx: PluginContext): Physics3DAPI["updateSensorState"] {
  return (entityId, sensorId, isActive, count) => {
    const owned = guardOwned(ctx, entityId, "updateSensorState");
    if (!owned) return;
    const slot = owned.slot;
    // Rust first: a rejected call leaves the local mirror as it was.
    if (ctx.backendMode === "wasm" && ctx.wasmBridge!.physics3d_update_sensor_state) {
      callPhysics3DExport(ctx, "physics3d_update_sensor_state", () =>
        ctx.wasmBridge!.physics3d_update_sensor_state!(slot, sensorId, isActive, count),
      );
    }
    let sensorMap = ctx.localSensorStates.get(slot);
    if (!sensorMap) {
      sensorMap = new Map();
      ctx.localSensorStates.set(slot, sensorMap);
    }
    sensorMap.set(sensorId, { contactCount: count, isActive });
  };
}

/**
 * @fileoverview Sensor state querying and updating.
 */

import type { Physics3DAPI } from "../types";
import { guardOwned } from "./entity-owner";
import type { PluginContext } from "./plugin-context";

export function createGetSensorState(ctx: PluginContext): Physics3DAPI["getSensorState"] {
  return (entityId, sensorId) => {
    const owned = guardOwned(ctx, entityId, "getSensorState");
    if (!owned) return { contactCount: 0, isActive: false };
    const slot = owned.slot;
    if (ctx.backendMode === "wasm" && ctx.wasmBridge!.physics3d_get_sensor_state) {
      const raw = ctx.wasmBridge!.physics3d_get_sensor_state(slot, sensorId);
      if (raw && (raw as unknown[]).length >= 2) {
        const contactCount = Number((raw as number[])[0]);
        const isActive = Number((raw as number[])[1]) !== 0;
        let sensorMap = ctx.localSensorStates.get(slot);
        if (!sensorMap) {
          sensorMap = new Map();
          ctx.localSensorStates.set(slot, sensorMap);
        }
        sensorMap.set(sensorId, { contactCount, isActive });
        return { contactCount, isActive };
      }
    }
    return ctx.localSensorStates.get(slot)?.get(sensorId) ?? { contactCount: 0, isActive: false };
  };
}

export function createUpdateSensorState(ctx: PluginContext): Physics3DAPI["updateSensorState"] {
  return (entityId, sensorId, isActive, count) => {
    const owned = guardOwned(ctx, entityId, "updateSensorState");
    if (!owned) return;
    const slot = owned.slot;
    let sensorMap = ctx.localSensorStates.get(slot);
    if (!sensorMap) {
      sensorMap = new Map();
      ctx.localSensorStates.set(slot, sensorMap);
    }
    sensorMap.set(sensorId, { contactCount: count, isActive });
    if (ctx.backendMode === "wasm" && ctx.wasmBridge!.physics3d_update_sensor_state) {
      ctx.wasmBridge!.physics3d_update_sensor_state(slot, sensorId, isActive ? 1 : 0, count);
    }
  };
}

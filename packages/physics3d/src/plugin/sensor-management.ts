/**
 * @fileoverview Sensor state querying and updating.
 */

import type { PhysicsSensorTracker } from "@gwenjs/physics-core";
import type { Physics3DAPI } from "../types";
import { guardOwned } from "./entity-owner";
import type { PluginContext } from "./plugin-context";
import { callPhysics3DExport } from "./wasm-errors";
import { liveWasmBridge } from "../internal/unchecked";

const COUNT_MASK = 0xffffffffn;
const ACTIVE_BIT = 1n << 32n;

export function createGetSensorState(
  ctx: PluginContext,
  sensors: PhysicsSensorTracker,
): Physics3DAPI["getSensorState"] {
  return (entityId, sensorId) => {
    const owned = guardOwned(ctx, entityId, "getSensorState");
    if (!owned) return { contactCount: 0, isActive: false };
    const slot = owned.slot;
    if (ctx.backendMode === "wasm" && liveWasmBridge(ctx.wasmBridge).physics3d_get_sensor_state) {
      // Packed by Rust: bits 0-31 are the contact count, bit 32 is the active flag.
      // `0n` is a registered body with no recorded state, not a failure.
      // Rust is authoritative here. The tracker is not written.
      const raw = callPhysics3DExport(ctx, "physics3d_get_sensor_state", () =>
        liveWasmBridge(ctx.wasmBridge).physics3d_get_sensor_state(slot, sensorId),
      );
      const contactCount = Number(raw & COUNT_MASK);
      const isActive = (raw & ACTIVE_BIT) !== 0n;
      return { contactCount, isActive };
    }
    return sensors.read(entityId, sensorId);
  };
}

export function createUpdateSensorState(
  ctx: PluginContext,
  sensors: PhysicsSensorTracker,
): Physics3DAPI["updateSensorState"] {
  return (entityId, sensorId, isActive, count) => {
    const owned = guardOwned(ctx, entityId, "updateSensorState");
    if (!owned) return;
    const slot = owned.slot;
    // Rust first: a rejected call leaves the tracker as it was.
    if (
      ctx.backendMode === "wasm" &&
      liveWasmBridge(ctx.wasmBridge).physics3d_update_sensor_state
    ) {
      callPhysics3DExport(ctx, "physics3d_update_sensor_state", () =>
        liveWasmBridge(ctx.wasmBridge).physics3d_update_sensor_state(
          slot,
          sensorId,
          isActive,
          count,
        ),
      );
    }
    sensors.set(entityId, sensorId, { contactCount: count, isActive });
  };
}

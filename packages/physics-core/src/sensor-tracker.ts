/**
 * Per-plugin overlap counts. The dispatch writes them. The adapter reads them.
 */

import type { EntityId } from "@gwenjs/schema";
import type { SensorState } from "./types.js";

/**
 * Read view of one plugin's sensor overlaps.
 * The same object stays current after each `engine:update`.
 */
export interface PhysicsSensorTracker {
  /**
   * Overlap of one entity and one sensor.
   * A pair that has never overlapped, or whose count is back to 0, is inactive.
   *
   * @param entityId - Entity that owns the sensor.
   * @param sensorId - Sensor id the adapter accepted for that entity.
   * @returns The count and whether it is active. Count 0 is inactive.
   */
  read(entityId: EntityId, sensorId: number): SensorState;
}

interface SensorChange {
  readonly changed: boolean;
  readonly state: SensorState;
}

/**
 * One tracker's read view and the writer the dispatch uses.
 * `sensors` is the object passed to `makeAdapter`.
 */
export interface SensorTracker {
  readonly sensors: PhysicsSensorTracker;
  /**
   * Record one overlap.
   * A start increments the count. An end decrements it and stops at 0.
   * `changed` is true only when `isActive` flips.
   *
   * @param entityId - Entity that owns the sensor.
   * @param sensorId - Sensor id the adapter accepted.
   * @param started - `true` when the overlap started, `false` when it ended.
   * @returns Whether the active flag flipped, and the state after the change.
   */
  apply(entityId: EntityId, sensorId: number, started: boolean): SensorChange;
}

/** A new tracker. One plugin instance owns one tracker. */
export function createSensorTracker(): SensorTracker {
  const byEntity = new Map<EntityId, Map<number, number>>();

  function read(entityId: EntityId, sensorId: number): SensorState {
    const count = byEntity.get(entityId)?.get(sensorId) ?? 0;
    return { contactCount: count, isActive: count > 0 };
  }

  return {
    sensors: { read },
    apply(entityId, sensorId, started) {
      let perSensor = byEntity.get(entityId);
      const previous = perSensor?.get(sensorId) ?? 0;
      let next = previous;
      if (started) next = previous + 1;
      else if (previous > 0) next = previous - 1;
      if (next === 0) {
        perSensor?.delete(sensorId);
        if (perSensor !== undefined && perSensor.size === 0) byEntity.delete(entityId);
      } else {
        if (perSensor === undefined) {
          perSensor = new Map();
          byEntity.set(entityId, perSensor);
        }
        perSensor.set(sensorId, next);
      }
      const beforeActive = previous > 0;
      const afterActive = next > 0;
      return {
        changed: beforeActive !== afterActive,
        state: { contactCount: next, isActive: afterActive },
      };
    },
  };
}

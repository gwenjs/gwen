/**
 * Per-plugin sensor overlaps. The dispatch, `update`, and `set` write one map.
 * The adapter reads that map. `update` and `set` emit nothing.
 */

import type { EntityId } from "@gwenjs/schema";
import type { SensorState } from "./types.js";

/**
 * One plugin's sensor overlaps, for the adapter.
 * `read` returns the stored pair. `set` writes that pair.
 * `update` steps the count. `set` and `update` emit nothing.
 * The same object stays current after each `engine:update`.
 */
export interface PhysicsSensorTracker {
  /**
   * Overlap of one entity and one sensor.
   * A pair that was never stored reads as count 0 and inactive.
   * After `set`, this returns `contactCount` and `isActive` as stored.
   * `isActive: true` with `contactCount: 0` reads back active at count 0.
   * `isActive: false` with a count above 0 reads back inactive at that count.
   * After `update` or a dispatch step, `isActive` is `contactCount > 0` again.
   *
   * @param entityId - Entity that owns the sensor.
   * @param sensorId - Sensor id the adapter accepted for that entity.
   * @returns The stored count and active flag.
   */
  read(entityId: EntityId, sensorId: number): SensorState;

  /**
   * Store one overlap exactly as given.
   * `contactCount` and `isActive` are kept, even when they disagree.
   * `read` returns that pair until `update`, a dispatch step, or `forget`.
   * This does not emit `onSensorEnter`, `onSensorExit`, or `physics:sensor:changed`.
   *
   * @param entityId - Entity that owns the sensor.
   * @param sensorId - Sensor id the adapter accepted for that entity.
   * @param state - Count and active flag to store.
   */
  set(entityId: EntityId, sensorId: number, state: SensorState): void;

  /**
   * Record one overlap on the same map the dispatch writes.
   * A start increments the stored count. An end decrements it and stops at 0.
   * The next `isActive` is `count > 0`.
   * This does not emit `onSensorEnter`, `onSensorExit`, or `physics:sensor:changed`.
   *
   * @param entityId - Entity that owns the sensor.
   * @param sensorId - Sensor id the adapter accepted for that entity.
   * @param started - `true` when the overlap started, `false` when it ended.
   */
  update(entityId: EntityId, sensorId: number, started: boolean): void;
}

interface SensorChange {
  readonly changed: boolean;
  readonly state: SensorState;
}

/**
 * One tracker's adapter view and the writer the dispatch uses.
 * `sensors` is the object passed to `makeAdapter`.
 * `apply`, `sensors.update`, and `sensors.set` write the same map.
 */
export interface SensorTracker {
  readonly sensors: PhysicsSensorTracker;
  /**
   * Record one overlap.
   * A start increments the stored count. An end decrements it and stops at 0.
   * The previous `isActive` is the stored flag, including a value from `set`.
   * The next `isActive` is `count > 0`.
   * `changed` is true only when `isActive` flips.
   *
   * @param entityId - Entity that owns the sensor.
   * @param sensorId - Sensor id the adapter accepted.
   * @param started - `true` when the overlap started, `false` when it ended.
   * @returns Whether the active flag flipped, and the state after the change.
   */
  apply(entityId: EntityId, sensorId: number, started: boolean): SensorChange;

  /**
   * Drop every overlap of one entity.
   * A later `read` reports count 0 and inactive.
   * The dispatch does not emit an exit for this drop.
   *
   * @param entityId - Entity that is gone.
   */
  forget(entityId: EntityId): void;
}

/** A new tracker. One plugin instance owns one tracker. */
export function createSensorTracker(): SensorTracker {
  const byEntity = new Map<EntityId, Map<number, SensorState>>();

  function read(entityId: EntityId, sensorId: number): SensorState {
    const stored = byEntity.get(entityId)?.get(sensorId);
    if (stored === undefined) return { contactCount: 0, isActive: false };
    return { contactCount: stored.contactCount, isActive: stored.isActive };
  }

  function dropEmpty(entityId: EntityId, perSensor: Map<number, SensorState>): void {
    if (perSensor.size === 0) byEntity.delete(entityId);
  }

  function write(entityId: EntityId, sensorId: number, started: boolean): SensorChange {
    let perSensor = byEntity.get(entityId);
    const stored = perSensor?.get(sensorId);
    const previous = stored?.contactCount ?? 0;
    const beforeActive = stored?.isActive ?? false;
    let next = previous;
    if (started) next = previous + 1;
    else if (previous > 0) next = previous - 1;
    const afterActive = next > 0;
    if (next === 0) {
      perSensor?.delete(sensorId);
      if (perSensor !== undefined) dropEmpty(entityId, perSensor);
    } else {
      if (perSensor === undefined) {
        perSensor = new Map();
        byEntity.set(entityId, perSensor);
      }
      perSensor.set(sensorId, { contactCount: next, isActive: afterActive });
    }
    return {
      changed: beforeActive !== afterActive,
      state: { contactCount: next, isActive: afterActive },
    };
  }

  function setState(entityId: EntityId, sensorId: number, state: SensorState): void {
    let perSensor = byEntity.get(entityId);
    if (state.contactCount === 0 && !state.isActive) {
      if (perSensor === undefined) return;
      perSensor.delete(sensorId);
      dropEmpty(entityId, perSensor);
      return;
    }
    if (perSensor === undefined) {
      perSensor = new Map();
      byEntity.set(entityId, perSensor);
    }
    perSensor.set(sensorId, { contactCount: state.contactCount, isActive: state.isActive });
  }

  return {
    sensors: {
      read,
      set: setState,
      update(entityId, sensorId, started) {
        write(entityId, sensorId, started);
      },
    },
    apply(entityId, sensorId, started) {
      return write(entityId, sensorId, started);
    },
    forget(entityId) {
      byEntity.delete(entityId);
    },
  };
}

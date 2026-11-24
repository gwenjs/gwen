/**
 * @file onSensorEnter / onSensorExit — register callbacks for sensor zone events.
 *
 * Callbacks live on the current engine's shared sensor registry.
 */
import { useEngine } from "@gwenjs/core";
import type { GwenEngine } from "@gwenjs/core";
import { _getActorContext } from "@gwenjs/core/internal";
import type { EntityId } from "@gwenjs/schema";
import {
  createSensorRegistry,
  onSensorEnter as coreOnSensorEnter,
  onSensorExit as coreOnSensorExit,
} from "@gwenjs/physics-core";
import type { SensorRegistry } from "@gwenjs/physics-core";

/**
 * Register a callback invoked when an entity enters a physics sensor zone.
 *
 * Callbacks are keyed by `sensorId` so that multiple sensors can coexist
 * within the same actor without interfering with one another.
 * Inside `defineActor`, the callback is stored for that actor's entity.
 *
 * @param sensorId - The collider ID of the sensor (from {@link useBoxCollider} or similar).
 * @param callback - Function invoked with the entering entity's packed slot index as a `bigint`.
 *
 * @example
 * ```typescript
 * const TriggerActor = defineActor(TriggerPrefab, () => {
 *   useStaticBody()
 *   const zone = useBoxCollider({ w: 4, h: 2, d: 4, isSensor: true })
 *   onSensorEnter(zone.colliderId, (entityId) => {
 *     console.log('Entity entered:', entityId)
 *   })
 * })
 * ```
 *
 * @since 1.0.0
 */
export function onSensorEnter(sensorId: number, callback: (entityId: bigint) => void): () => void {
  return coreOnSensorEnter(sensorId, callback, _getActorContext()?.entityId);
}

/**
 * Register a callback invoked when an entity exits a physics sensor zone.
 *
 * Inside `defineActor`, the callback is stored for that actor's entity.
 *
 * @param sensorId - The collider ID of the sensor.
 * @param callback - Function invoked with the exiting entity's packed slot index as a `bigint`.
 *
 * @example
 * ```typescript
 * onSensorExit(zone.colliderId, (entityId) => {
 *   console.log('Entity left the zone:', entityId)
 * })
 * ```
 *
 * @since 1.0.0
 */
export function onSensorExit(sensorId: number, callback: (entityId: bigint) => void): () => void {
  return coreOnSensorExit(sensorId, callback, _getActorContext()?.entityId);
}

/**
 * Dispatch a sensor-enter event to all callbacks registered for `sensorId`.
 *
 * Called by the Physics3D plugin during the `onUpdate` phase.
 *
 * @param sensorId - The collider ID of the sensor that was entered.
 * @param entityId - Packed slot index of the entity that entered.
 * @internal
 */
export function _dispatchSensorEnter(sensorId: number, entityId: EntityId): void {
  sensorRegistry()?.emit(sensorId, entityId, "enter");
}

/**
 * Dispatch a sensor-exit event to all callbacks registered for `sensorId`.
 *
 * @param sensorId - The collider ID of the sensor that was exited.
 * @param entityId - Packed slot index of the entity that exited.
 * @internal
 */
export function _dispatchSensorExit(sensorId: number, entityId: EntityId): void {
  sensorRegistry()?.emit(sensorId, entityId, "exit");
}

/**
 * Remove callbacks for one sensor.
 * A number clears callbacks registered outside an actor.
 * A bigint plus `sensorId` clears that entity only.
 * No arguments clears every callback on this engine.
 */
export function _clearSensorCallbacks(sensorOrEntity?: number | EntityId, sensorId?: number): void {
  const registry = sensorRegistry();
  if (registry === undefined) return;
  if (sensorOrEntity === undefined) {
    registry.entries.length = 0;
    return;
  }
  if (typeof sensorOrEntity === "number") {
    const callbacks: Array<(entityId: EntityId) => void> = [];
    for (const entry of registry.entries) {
      if (entry.sensorId !== sensorOrEntity || entry.ownerEntityId !== undefined) continue;
      callbacks.push(entry.cb);
    }
    registry.remove(callbacks);
    return;
  }
  if (sensorId === undefined) return;
  registry.removeOwned(sensorOrEntity, sensorId);
}

/** Drop every sensor callback owned by `engine`. */
export function clearEngineSensors(engine: GwenEngine): void {
  const registry = createSensorRegistry().peek(engine);
  if (registry === undefined) return;
  registry.entries.length = 0;
}

function sensorRegistry(): SensorRegistry | undefined {
  return createSensorRegistry().peek(useEngine("Physics3DPlugin"));
}

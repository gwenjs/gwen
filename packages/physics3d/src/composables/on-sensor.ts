/**
 * @file onSensorEnter / onSensorExit — register callbacks for sensor zone events.
 *
 * Maps live on the current engine.
 */
import { createEngineLocal, GwenContextError } from "@gwenjs/core";
import type { GwenEngine } from "@gwenjs/core";

type SensorCallback = (entityId: bigint) => void;

interface SensorRegistry {
  enter: Map<number, SensorCallback[]>;
  exit: Map<number, SensorCallback[]>;
}

const sensors = createEngineLocal<SensorRegistry>(() => ({
  enter: new Map(),
  exit: new Map(),
}));

function registryOrNull(): SensorRegistry | undefined {
  try {
    return sensors.use();
  } catch (error) {
    if (error instanceof GwenContextError) return undefined;
    throw error;
  }
}

/**
 * Register a callback invoked when an entity enters a physics sensor zone.
 *
 * Callbacks are keyed by `sensorId` so that multiple sensors can coexist
 * within the same actor without interfering with one another.
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
  const registry = sensors.use();
  const existing = registry.enter.get(sensorId) ?? [];
  existing.push(callback);
  registry.enter.set(sensorId, existing);
  return () => {
    const cbs = registry.enter.get(sensorId);
    if (!cbs) return;
    const idx = cbs.indexOf(callback);
    if (idx !== -1) cbs.splice(idx, 1);
  };
}

/**
 * Register a callback invoked when an entity exits a physics sensor zone.
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
  const registry = sensors.use();
  const existing = registry.exit.get(sensorId) ?? [];
  existing.push(callback);
  registry.exit.set(sensorId, existing);
  return () => {
    const cbs = registry.exit.get(sensorId);
    if (!cbs) return;
    const idx = cbs.indexOf(callback);
    if (idx !== -1) cbs.splice(idx, 1);
  };
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
export function _dispatchSensorEnter(sensorId: number, entityId: bigint): void {
  const cbs = registryOrNull()?.enter.get(sensorId);
  if (!cbs) return;
  for (const cb of cbs) cb(entityId);
}

/**
 * Dispatch a sensor-exit event to all callbacks registered for `sensorId`.
 *
 * @param sensorId - The collider ID of the sensor that was exited.
 * @param entityId - Packed slot index of the entity that exited.
 * @internal
 */
export function _dispatchSensorExit(sensorId: number, entityId: bigint): void {
  const cbs = registryOrNull()?.exit.get(sensorId);
  if (!cbs) return;
  for (const cb of cbs) cb(entityId);
}

/**
 * Remove all registered sensor callbacks for all sensors.
 *
 * Used in tests and plugin teardown to reset the callback registries.
 *
 * @internal
 */
export function _clearSensorCallbacks(): void {
  const registry = registryOrNull();
  if (!registry) return;
  registry.enter.clear();
  registry.exit.clear();
}

/** Drop every sensor callback owned by `engine`. */
export function clearEngineSensors(engine: GwenEngine): void {
  const registry = sensors.peek(engine);
  if (!registry) return;
  registry.enter.clear();
  registry.exit.clear();
}

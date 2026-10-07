/**
 * @file onSensorEnter / onSensorExit — register callbacks for sensor zone events.
 *
 * Maps live on the current engine.
 */
import { createEngineLocal, GwenContextError } from "@gwenjs/core";
import type { GwenEngine } from "@gwenjs/core";
import { _getActorContext } from "@gwenjs/core/internal";

type SensorCallback = (entityId: bigint) => void;

interface SensorRegistry {
  enter: Map<string, SensorCallback[]>;
  exit: Map<string, SensorCallback[]>;
}

/** Unbound callbacks use `*:sensorId`. Actor callbacks use `entity:sensorId`. */
function sensorKey(sensorId: number, entityId?: bigint): string {
  return entityId === undefined ? `*:${sensorId}` : `${entityId}:${sensorId}`;
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
  const key = sensorKey(sensorId, _getActorContext()?.entityId);
  const existing = registry.enter.get(key) ?? [];
  existing.push(callback);
  registry.enter.set(key, existing);
  return () => {
    const cbs = registry.enter.get(key);
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
  const key = sensorKey(sensorId, _getActorContext()?.entityId);
  const existing = registry.exit.get(key) ?? [];
  existing.push(callback);
  registry.exit.set(key, existing);
  return () => {
    const cbs = registry.exit.get(key);
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
function fire(
  map: Map<string, SensorCallback[]> | undefined,
  sensorId: number,
  entityId: bigint,
): void {
  if (!map) return;
  const specific = map.get(sensorKey(sensorId, entityId));
  const shared = map.get(sensorKey(sensorId));
  if (specific) for (const cb of specific) cb(entityId);
  if (shared) for (const cb of shared) cb(entityId);
}

export function _dispatchSensorEnter(sensorId: number, entityId: bigint): void {
  fire(registryOrNull()?.enter, sensorId, entityId);
}

/**
 * Dispatch a sensor-exit event to all callbacks registered for `sensorId`.
 *
 * @param sensorId - The collider ID of the sensor that was exited.
 * @param entityId - Packed slot index of the entity that exited.
 * @internal
 */
export function _dispatchSensorExit(sensorId: number, entityId: bigint): void {
  fire(registryOrNull()?.exit, sensorId, entityId);
}

/**
 * Remove callbacks for one sensor.
 * A number clears callbacks registered outside an actor.
 * A bigint plus `sensorId` clears that entity only.
 * No arguments clears every callback on this engine.
 */
export function _clearSensorCallbacks(sensorOrEntity?: number | bigint, sensorId?: number): void {
  const registry = registryOrNull();
  if (!registry) return;
  if (sensorOrEntity === undefined) {
    registry.enter.clear();
    registry.exit.clear();
    return;
  }
  if (typeof sensorOrEntity === "number") {
    registry.enter.delete(sensorKey(sensorOrEntity));
    registry.exit.delete(sensorKey(sensorOrEntity));
    return;
  }
  if (sensorId === undefined) return;
  registry.enter.delete(sensorKey(sensorId, sensorOrEntity));
  registry.exit.delete(sensorKey(sensorId, sensorOrEntity));
}

/** Drop every sensor callback owned by `engine`. */
export function clearEngineSensors(engine: GwenEngine): void {
  const registry = sensors.peek(engine);
  if (!registry) return;
  registry.enter.clear();
  registry.exit.clear();
}

/**
 * @file onSensorEnter() / onSensorExit() — sensor overlap event composables.
 */
import { useEngine, createEngineLocal } from "@gwenjs/core";
import type { GwenEngine } from "@gwenjs/core";
import { _getActorContext } from "@gwenjs/core/internal";

type SensorCallback = (entityId: bigint) => void;

interface SensorRegistry {
  enter: Map<string, SensorCallback[]>;
  exit: Map<string, SensorCallback[]>;
}

const sensors = createEngineLocal<SensorRegistry>(() => ({
  enter: new Map(),
  exit: new Map(),
}));

/** Unbound callbacks use `*:sensorId`. Actor callbacks use `entity:sensorId`. */
function sensorKey(sensorId: number, entityId?: bigint): string {
  return entityId === undefined ? `*:${sensorId}` : `${entityId}:${sensorId}`;
}

function listFor(map: Map<string, SensorCallback[]>, key: string): SensorCallback[] {
  const existing = map.get(key);
  if (existing) return existing;
  const created: SensorCallback[] = [];
  map.set(key, created);
  return created;
}

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

/** @internal Called by the physics2d plugin for sensor enter events on this engine. */
export function _dispatchSensorEnter(sensorId: number, entityId: bigint): void {
  fire(sensors.peek(useEngine())?.enter, sensorId, entityId);
}

/** @internal Called by the physics2d plugin for sensor exit events on this engine. */
export function _dispatchSensorExit(sensorId: number, entityId: bigint): void {
  fire(sensors.peek(useEngine())?.exit, sensorId, entityId);
}

/**
 * Remove callbacks for one sensor.
 * A number clears callbacks registered outside an actor.
 * A bigint plus `sensorId` clears that entity only.
 */
export function _clearSensorCallbacks(sensorOrEntity: number | bigint, sensorId?: number): void {
  const registry = sensors.peek(useEngine());
  if (!registry) return;
  if (typeof sensorOrEntity === "number") {
    registry.enter.delete(sensorKey(sensorOrEntity));
    registry.exit.delete(sensorKey(sensorOrEntity));
    return;
  }
  if (sensorId === undefined) return;
  registry.enter.delete(sensorKey(sensorId, sensorOrEntity));
  registry.exit.delete(sensorKey(sensorId, sensorOrEntity));
}

/** @internal Drop every sensor callback owned by `engine`. */
export function clearEngineSensors(engine: GwenEngine): void {
  const registry = sensors.peek(engine);
  if (!registry) return;
  registry.enter.clear();
  registry.exit.clear();
}

/**
 * Subscribes to sensor overlap entry events on the current engine.
 * Inside `defineActor`, the callback belongs to that actor's entity.
 *
 * @throws {GwenContextError} `CORE:OUTSIDE_ENGINE_CONTEXT` when no engine is current.
 */
export function onSensorEnter(sensorId: number, callback: SensorCallback): void {
  listFor(sensors.use().enter, sensorKey(sensorId, _getActorContext()?.entityId)).push(callback);
}

/**
 * Subscribes to sensor overlap exit events on the current engine.
 * Inside `defineActor`, the callback belongs to that actor's entity.
 *
 * @throws {GwenContextError} `CORE:OUTSIDE_ENGINE_CONTEXT` when no engine is current.
 */
export function onSensorExit(sensorId: number, callback: SensorCallback): void {
  listFor(sensors.use().exit, sensorKey(sensorId, _getActorContext()?.entityId)).push(callback);
}

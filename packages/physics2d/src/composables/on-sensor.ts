/**
 * @file onSensorEnter() / onSensorExit() — sensor overlap event composables.
 */
import { useEngine, createEngineLocal } from "@gwenjs/core";
import type { GwenEngine } from "@gwenjs/core";

interface SensorRegistry {
  enter: Map<number, ((entityId: bigint) => void)[]>;
  exit: Map<number, ((entityId: bigint) => void)[]>;
}

const sensors = createEngineLocal<SensorRegistry>(() => ({
  enter: new Map(),
  exit: new Map(),
}));

function listFor(
  map: Map<number, ((entityId: bigint) => void)[]>,
  sensorId: number,
): ((entityId: bigint) => void)[] {
  const existing = map.get(sensorId);
  if (existing) return existing;
  const created: ((entityId: bigint) => void)[] = [];
  map.set(sensorId, created);
  return created;
}

/** @internal Called by the physics2d plugin for sensor enter events on this engine. */
export function _dispatchSensorEnter(sensorId: number, entityId: bigint): void {
  const cbs = sensors.peek(useEngine())?.enter.get(sensorId);
  if (!cbs) return;
  for (const cb of cbs) cb(entityId);
}

/** @internal Called by the physics2d plugin for sensor exit events on this engine. */
export function _dispatchSensorExit(sensorId: number, entityId: bigint): void {
  const cbs = sensors.peek(useEngine())?.exit.get(sensorId);
  if (!cbs) return;
  for (const cb of cbs) cb(entityId);
}

/** @internal Remove this engine's callbacks for one sensor. */
export function _clearSensorCallbacks(sensorId: number): void {
  const registry = sensors.peek(useEngine());
  if (!registry) return;
  registry.enter.delete(sensorId);
  registry.exit.delete(sensorId);
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
 *
 * @throws {GwenContextError} `CORE:OUTSIDE_ENGINE_CONTEXT` when no engine is current.
 */
export function onSensorEnter(sensorId: number, callback: (entityId: bigint) => void): void {
  listFor(sensors.use().enter, sensorId).push(callback);
}

/**
 * Subscribes to sensor overlap exit events on the current engine.
 *
 * @throws {GwenContextError} `CORE:OUTSIDE_ENGINE_CONTEXT` when no engine is current.
 */
export function onSensorExit(sensorId: number, callback: (entityId: bigint) => void): void {
  listFor(sensors.use().exit, sensorId).push(callback);
}

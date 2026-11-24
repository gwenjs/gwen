/**
 * @file onSensorEnter() / onSensorExit() — sensor overlap event composables.
 */
import { createEngineLocal, useEngine } from "@gwenjs/core";
import type { GwenEngine } from "@gwenjs/core";
import { _getActorContext } from "@gwenjs/core/internal";
import type { EntityId } from "@gwenjs/schema";
import {
  createSensorRegistry,
  onSensorEnter as coreOnSensorEnter,
  onSensorExit as coreOnSensorExit,
} from "@gwenjs/physics-core";

type SensorCallback = (entityId: EntityId) => void;

interface SensorOwner {
  entityId: EntityId;
  sensorId: number;
  cb: SensorCallback;
}

const sensorOwners = createEngineLocal<SensorOwner[]>(() => []);

/** @internal Called by tests for sensor enter events on this engine. */
export function _dispatchSensorEnter(sensorId: number, entityId: EntityId): void {
  createSensorRegistry().peek(useEngine("Physics2DPlugin"))?.emit(sensorId, entityId, "enter");
}

/** @internal Called by tests for sensor exit events on this engine. */
export function _dispatchSensorExit(sensorId: number, entityId: EntityId): void {
  createSensorRegistry().peek(useEngine("Physics2DPlugin"))?.emit(sensorId, entityId, "exit");
}

/**
 * Remove callbacks for one sensor.
 * A number clears callbacks registered outside an actor.
 * A bigint plus `sensorId` clears that entity only.
 * The registry defers a removal requested during `emit`.
 */
export function _clearSensorCallbacks(sensorOrEntity: number | bigint, sensorId?: number): void {
  const engine = useEngine("Physics2DPlugin");
  const registry = createSensorRegistry().peek(engine);
  const owners = sensorOwners.peek(engine);
  if (registry === undefined) return;
  const entries = registry.entries;
  if (typeof sensorOrEntity === "number") {
    const owned = new Set<SensorCallback>();
    if (owners !== undefined) {
      for (const owner of owners) {
        if (owner.sensorId === sensorOrEntity) owned.add(owner.cb);
      }
    }
    const callbacks: SensorCallback[] = [];
    for (const entry of entries) {
      if (entry.sensorId !== sensorOrEntity || owned.has(entry.cb)) continue;
      callbacks.push(entry.cb);
    }
    registry.remove(callbacks);
    return;
  }
  if (sensorId === undefined) return;
  const owned = new Set<SensorCallback>();
  if (owners !== undefined) {
    for (let index = owners.length - 1; index >= 0; index -= 1) {
      const owner = owners[index];
      if (owner === undefined) continue;
      if (owner.entityId !== sensorOrEntity || owner.sensorId !== sensorId) continue;
      owned.add(owner.cb);
      owners.splice(index, 1);
    }
  }
  registry.remove([...owned]);
}

/** @internal Drop every sensor callback owned by `engine`. */
export function clearEngineSensors(engine: GwenEngine): void {
  const entries = createSensorRegistry().peek(engine)?.entries;
  if (entries !== undefined) entries.length = 0;
  const owners = sensorOwners.peek(engine);
  if (owners !== undefined) owners.length = 0;
}

function bindSensor(
  phase: "enter" | "exit",
  sensorId: number,
  callback: SensorCallback,
): () => void {
  const engine = useEngine(phase === "enter" ? "onSensorEnter" : "onSensorExit");
  const actorId = _getActorContext()?.entityId;
  const delivered: SensorCallback =
    actorId === undefined
      ? callback
      : (id) => {
          if (id === actorId) callback(id);
        };
  const off =
    phase === "enter"
      ? coreOnSensorEnter(sensorId, delivered)
      : coreOnSensorExit(sensorId, delivered);
  if (actorId === undefined) return off;
  const owners = sensorOwners.get(engine);
  const owner: SensorOwner = { entityId: actorId, sensorId, cb: delivered };
  owners.push(owner);
  return () => {
    off();
    const index = owners.indexOf(owner);
    if (index >= 0) owners.splice(index, 1);
  };
}

/**
 * Subscribes to sensor overlap entry events on the current engine.
 * Inside `defineActor`, the callback belongs to that actor's entity and is
 * removed when that entity is destroyed. Outside an actor, call the returned
 * function to remove it.
 *
 * @returns A function that removes this callback.
 * @throws {GwenContextError} `CORE:OUTSIDE_ENGINE_CONTEXT` when no engine is current.
 */
export function onSensorEnter(sensorId: number, callback: SensorCallback): () => void {
  return bindSensor("enter", sensorId, callback);
}

/**
 * Subscribes to sensor overlap exit events on the current engine.
 * Inside `defineActor`, the callback belongs to that actor's entity and is
 * removed when that entity is destroyed. Outside an actor, call the returned
 * function to remove it.
 *
 * @returns A function that removes this callback.
 * @throws {GwenContextError} `CORE:OUTSIDE_ENGINE_CONTEXT` when no engine is current.
 */
export function onSensorExit(sensorId: number, callback: SensorCallback): () => void {
  return bindSensor("exit", sensorId, callback);
}

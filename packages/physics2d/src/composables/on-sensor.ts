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

let sensorEmitDepth = 0;
const pendingSensorClears: Array<{ engine: GwenEngine; callbacks: SensorCallback[] }> = [];

function flushSensorClears(): void {
  const pending = pendingSensorClears.splice(0, pendingSensorClears.length);
  for (const item of pending) {
    const entries = createSensorRegistry().peek(item.engine)?.entries;
    if (entries === undefined) continue;
    const owned = new Set(item.callbacks);
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index];
      if (entry !== undefined && owned.has(entry.cb)) entries.splice(index, 1);
    }
  }
}

function runSensorEmit(run: () => void): void {
  sensorEmitDepth += 1;
  try {
    run();
  } finally {
    sensorEmitDepth -= 1;
    if (sensorEmitDepth === 0) flushSensorClears();
  }
}

/** @internal Called by the physics2d plugin for sensor enter events on this engine. */
export function _dispatchSensorEnter(sensorId: number, entityId: EntityId): void {
  runSensorEmit(() => {
    createSensorRegistry().peek(useEngine("Physics2DPlugin"))?.emit(sensorId, entityId, "enter");
  });
}

/** @internal Called by the physics2d plugin for sensor exit events on this engine. */
export function _dispatchSensorExit(sensorId: number, entityId: EntityId): void {
  runSensorEmit(() => {
    createSensorRegistry().peek(useEngine("Physics2DPlugin"))?.emit(sensorId, entityId, "exit");
  });
}

function queueOrDropSensorEntries(
  engine: GwenEngine,
  entries: Array<{ readonly cb: SensorCallback }>,
  callbacks: SensorCallback[],
): void {
  if (callbacks.length === 0) return;
  if (sensorEmitDepth > 0) {
    pendingSensorClears.push({ engine, callbacks });
    return;
  }
  const owned = new Set(callbacks);
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry !== undefined && owned.has(entry.cb)) entries.splice(index, 1);
  }
}

/**
 * Remove callbacks for one sensor.
 * A number clears callbacks registered outside an actor.
 * A bigint plus `sensorId` clears that entity only.
 * Removals requested during `emit` wait until the walk finishes.
 */
export function _clearSensorCallbacks(sensorOrEntity: number | bigint, sensorId?: number): void {
  const engine = useEngine("Physics2DPlugin");
  const entries = createSensorRegistry().peek(engine)?.entries;
  const owners = sensorOwners.peek(engine);
  if (entries === undefined) return;
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
    queueOrDropSensorEntries(engine, entries, callbacks);
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
  queueOrDropSensorEntries(engine, entries, [...owned]);
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

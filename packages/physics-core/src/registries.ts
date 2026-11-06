/**
 * Per-engine contact and sensor callbacks.
 * Each engine's list dies with that engine's `stop()`.
 */

import { createEngineLocal, useEngine } from "@gwenjs/core";
import type { EngineLocal, GwenEngine } from "@gwenjs/core";
import type { EntityId } from "@gwenjs/schema";
import type { CollisionContact } from "./types.js";

/** Well-known foot sensor id shared by both dimensions. */
export const SENSOR_ID_FOOT = 0xf007;

interface ContactEntry {
  readonly cb: (contact: CollisionContact) => void;
  readonly entityId: EntityId | undefined;
}

/** Callbacks stored for one engine. `emit` runs them. */
export interface ContactRegistry {
  readonly entries: ContactEntry[];
  emit(contact: CollisionContact): void;
}

interface SensorEntry {
  readonly sensorId: number;
  readonly phase: "enter" | "exit";
  readonly cb: (entityId: EntityId) => void;
}

/** Sensor callbacks stored for one engine. */
export interface SensorRegistry {
  readonly entries: SensorEntry[];
  emit(sensorId: number, entityId: EntityId, phase: "enter" | "exit"): void;
}

/** Drop contact and sensor callbacks that belong to `engine`. */
export function clearEngineContacts(engine: GwenEngine): void {
  const contacts = contactLocals.peek(engine);
  if (contacts !== undefined) contacts.entries.length = 0;
  const sensors = sensorLocals.peek(engine);
  if (sensors !== undefined) sensors.entries.length = 0;
}

function removeOnce<T>(list: T[], entry: T): () => void {
  return () => {
    const index = list.indexOf(entry);
    if (index >= 0) list.splice(index, 1);
  };
}

const contactLocals = createEngineLocal<ContactRegistry>(
  () => {
    const entries: ContactEntry[] = [];
    return {
      entries,
      emit(contact: CollisionContact): void {
        for (const entry of entries) {
          if (
            entry.entityId !== undefined &&
            entry.entityId !== contact.entityA &&
            entry.entityId !== contact.entityB
          ) {
            continue;
          }
          entry.cb(contact);
        }
      },
    };
  },
  (registry) => {
    registry.entries.length = 0;
  },
);

const sensorLocals = createEngineLocal<SensorRegistry>(
  () => {
    const entries: SensorEntry[] = [];
    return {
      entries,
      emit(sensorId: number, entityId: EntityId, phase: "enter" | "exit"): void {
        for (const entry of entries) {
          if (entry.sensorId !== sensorId || entry.phase !== phase) continue;
          entry.cb(entityId);
        }
      },
    };
  },
  (registry) => {
    registry.entries.length = 0;
  },
);

/** The contact list for each engine. The same value is returned on every call. */
export function createContactRegistry(): EngineLocal<ContactRegistry> {
  return contactLocals;
}

/** The sensor list for each engine. The same value is returned on every call. */
export function createSensorRegistry(): EngineLocal<SensorRegistry> {
  return sensorLocals;
}

/**
 * Subscribe to contacts on the current engine.
 * `entityId` limits the callback to contacts that include that entity.
 * Without `entityId` the callback receives every contact of the engine.
 * Unlike today's `@gwenjs/physics2d` `onContact`, it does not default to the current actor.
 *
 * @throws {GwenContextError} `CORE:OUTSIDE_ENGINE_CONTEXT` when no engine is current.
 */
export function onContact(
  cb: (contact: CollisionContact) => void,
  entityId?: EntityId,
): () => void {
  const engine = useEngine("onContact");
  const registry = contactLocals.get(engine);
  const entry: ContactEntry = { cb, entityId };
  registry.entries.push(entry);
  return removeOnce(registry.entries, entry);
}

/**
 * Subscribe to a sensor becoming active on the current engine.
 *
 * @throws {GwenContextError} `CORE:OUTSIDE_ENGINE_CONTEXT` when no engine is current.
 */
export function onSensorEnter(sensorId: number, cb: (entityId: EntityId) => void): () => void {
  const engine = useEngine("onSensorEnter");
  return addSensor(engine, sensorId, "enter", cb);
}

/**
 * Subscribe to a sensor becoming inactive on the current engine.
 *
 * @throws {GwenContextError} `CORE:OUTSIDE_ENGINE_CONTEXT` when no engine is current.
 */
export function onSensorExit(sensorId: number, cb: (entityId: EntityId) => void): () => void {
  const engine = useEngine("onSensorExit");
  return addSensor(engine, sensorId, "exit", cb);
}

function addSensor(
  engine: GwenEngine,
  sensorId: number,
  phase: "enter" | "exit",
  cb: (entityId: EntityId) => void,
): () => void {
  const registry = sensorLocals.get(engine);
  const entry: SensorEntry = { sensorId, phase, cb };
  registry.entries.push(entry);
  return removeOnce(registry.entries, entry);
}

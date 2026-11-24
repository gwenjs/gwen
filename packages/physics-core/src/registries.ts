/**
 * Per-engine contact and sensor callbacks.
 * Each engine's list dies with that engine's `stop()`.
 * A removal during `emit` waits until the outermost `emit` returns.
 * The entry stays in `entries` for that walk. Outside `emit` it drops at once.
 * `clearEngineContacts` and `stop()` empty the lists at once, even during a walk.
 * A sensor entry stores `ownerEntityId` only when that argument was passed.
 * `emit` keeps registration order and skips a set owner that is not the event entity.
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
  /**
   * Drop every entry whose `entityId` equals `entityId`.
   * During `emit` those entries stay until the outermost `emit` returns.
   *
   * @param entityId - Entity whose callbacks should leave the list.
   */
  removeEntity(entityId: EntityId): void;
}

interface SensorEntry {
  readonly sensorId: number;
  readonly phase: "enter" | "exit";
  readonly cb: (entityId: EntityId) => void;
  readonly ownerEntityId?: EntityId;
}

/** Sensor callbacks stored for one engine. */
export interface SensorRegistry {
  readonly entries: SensorEntry[];
  emit(sensorId: number, entityId: EntityId, phase: "enter" | "exit"): void;
  /**
   * Drop every entry whose callback is in `callbacks`.
   * An empty list drops nothing.
   * During `emit` those entries stay until the outermost `emit` returns.
   *
   * @param callbacks - Callbacks to drop. Identity is the function reference.
   */
  remove(callbacks: readonly ((entityId: EntityId) => void)[]): void;
  /**
   * Drop every entry stored for `entityId`.
   * Pass `sensorId` to drop only that sensor. A second call drops nothing.
   * During `emit` those entries stay until the outermost `emit` returns.
   *
   * @param entityId - Owner whose callbacks should leave the list.
   * @param sensorId - When set, only this sensor is dropped.
   */
  removeOwned(entityId: EntityId, sensorId?: number): void;
}

interface RemovalGate {
  depth: number;
  pending: Array<() => void>;
}

function schedule(gate: RemovalGate, apply: () => void): void {
  if (gate.depth > 0) {
    gate.pending.push(apply);
    return;
  }
  apply();
}

function finishEmit(gate: RemovalGate): void {
  gate.depth -= 1;
  if (gate.depth > 0) return;
  const pending = gate.pending.splice(0, gate.pending.length);
  for (const apply of pending) apply();
}

const contactGates = new WeakMap<ContactRegistry, RemovalGate>();
const sensorGates = new WeakMap<SensorRegistry, RemovalGate>();

function removalGate<T extends object>(gates: WeakMap<T, RemovalGate>, registry: T): RemovalGate {
  const found = gates.get(registry);
  if (found !== undefined) return found;
  const created: RemovalGate = { depth: 0, pending: [] };
  gates.set(registry, created);
  return created;
}

function dropEntityFrom(entries: ContactEntry[], entityId: EntityId): void {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry !== undefined && entry.entityId === entityId) entries.splice(index, 1);
  }
}

function dropSensorCallbacks(
  entries: SensorEntry[],
  callbacks: readonly ((entityId: EntityId) => void)[],
): void {
  const owned = new Set(callbacks);
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry !== undefined && owned.has(entry.cb)) entries.splice(index, 1);
  }
}

function dropOwned(entries: SensorEntry[], entityId: EntityId, sensorId: number | undefined): void {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry === undefined || entry.ownerEntityId !== entityId) continue;
    if (sensorId !== undefined && entry.sensorId !== sensorId) continue;
    entries.splice(index, 1);
  }
}

/** Drop contact and sensor callbacks that belong to `engine`. */
export function clearEngineContacts(engine: GwenEngine): void {
  const contacts = contactLocals.peek(engine);
  if (contacts !== undefined) contacts.entries.length = 0;
  const sensors = sensorLocals.peek(engine);
  if (sensors !== undefined) sensors.entries.length = 0;
}

const contactLocals = createEngineLocal<ContactRegistry>(
  () => {
    const entries: ContactEntry[] = [];
    const registry: ContactRegistry = {
      entries,
      emit(contact: CollisionContact): void {
        const gate = removalGate(contactGates, registry);
        gate.depth += 1;
        try {
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
        } finally {
          finishEmit(gate);
        }
      },
      removeEntity(entityId: EntityId): void {
        const gate = removalGate(contactGates, registry);
        schedule(gate, () => {
          dropEntityFrom(entries, entityId);
        });
      },
    };
    return registry;
  },
  (registry) => {
    registry.entries.length = 0;
  },
);

const sensorLocals = createEngineLocal<SensorRegistry>(
  () => {
    const entries: SensorEntry[] = [];
    const registry: SensorRegistry = {
      entries,
      emit(sensorId: number, entityId: EntityId, phase: "enter" | "exit"): void {
        const gate = removalGate(sensorGates, registry);
        gate.depth += 1;
        try {
          for (const entry of entries) {
            if (entry.sensorId !== sensorId || entry.phase !== phase) continue;
            if (entry.ownerEntityId !== undefined && entry.ownerEntityId !== entityId) continue;
            entry.cb(entityId);
          }
        } finally {
          finishEmit(gate);
        }
      },
      remove(callbacks: readonly ((entityId: EntityId) => void)[]): void {
        if (callbacks.length === 0) return;
        const gate = removalGate(sensorGates, registry);
        schedule(gate, () => {
          dropSensorCallbacks(entries, callbacks);
        });
      },
      removeOwned(entityId: EntityId, sensorId?: number): void {
        const gate = removalGate(sensorGates, registry);
        schedule(gate, () => {
          dropOwned(entries, entityId, sensorId);
        });
      },
    };
    return registry;
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
 * The returned function drops this callback. During `emit` that drop waits until the outermost `emit` returns.
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
  const gate = removalGate(contactGates, registry);
  return () => {
    schedule(gate, () => {
      const index = registry.entries.indexOf(entry);
      if (index >= 0) registry.entries.splice(index, 1);
    });
  };
}

/**
 * Subscribe to a sensor becoming active on the current engine.
 * Pass `ownerEntityId` to deliver this callback only for that entity.
 * Omit it and the callback receives every entity. `emit` keeps registration order.
 * The returned function drops this callback. During `emit` that drop waits until the outermost `emit` returns.
 *
 * @param sensorId - Sensor whose enter events call `cb`.
 * @param cb - Called with the entity that entered.
 * @param ownerEntityId - When passed, `cb` runs only for this entity.
 * @throws {GwenContextError} `CORE:OUTSIDE_ENGINE_CONTEXT` when no engine is current.
 */
export function onSensorEnter(
  sensorId: number,
  cb: (entityId: EntityId) => void,
  ownerEntityId?: EntityId,
): () => void {
  const engine = useEngine("onSensorEnter");
  return addSensor(engine, sensorId, "enter", cb, ownerEntityId);
}

/**
 * Subscribe to a sensor becoming inactive on the current engine.
 * Pass `ownerEntityId` to deliver this callback only for that entity.
 * Omit it and the callback receives every entity. `emit` keeps registration order.
 * The returned function drops this callback. During `emit` that drop waits until the outermost `emit` returns.
 *
 * @param sensorId - Sensor whose exit events call `cb`.
 * @param cb - Called with the entity that exited.
 * @param ownerEntityId - When passed, `cb` runs only for this entity.
 * @throws {GwenContextError} `CORE:OUTSIDE_ENGINE_CONTEXT` when no engine is current.
 */
export function onSensorExit(
  sensorId: number,
  cb: (entityId: EntityId) => void,
  ownerEntityId?: EntityId,
): () => void {
  const engine = useEngine("onSensorExit");
  return addSensor(engine, sensorId, "exit", cb, ownerEntityId);
}

function addSensor(
  engine: GwenEngine,
  sensorId: number,
  phase: "enter" | "exit",
  cb: (entityId: EntityId) => void,
  ownerEntityId?: EntityId,
): () => void {
  const registry = sensorLocals.get(engine);
  const entry: SensorEntry =
    ownerEntityId === undefined ? { sensorId, phase, cb } : { sensorId, phase, cb, ownerEntityId };
  registry.entries.push(entry);
  const gate = removalGate(sensorGates, registry);
  return () => {
    schedule(gate, () => {
      const index = registry.entries.indexOf(entry);
      if (index >= 0) registry.entries.splice(index, 1);
    });
  };
}

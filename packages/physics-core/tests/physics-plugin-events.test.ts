/**
 * Shared dispatch of decoded contacts and sensor transitions.
 * `tests/*.test.ts` are outside `tsconfig.test.json` (`include` is `tests/types` only).
 */

import { afterEach, expect, it } from "vitest";
import type { GwenEngine } from "@gwenjs/core";
import { createEngine } from "@gwenjs/core/node";
import type { GwenErrorPayload } from "@gwenjs/schema";
import * as api from "../src/index.js";
import type { CollisionContact, CollisionEventLayout, SensorState } from "../src/index.js";

const SERVICE_KEY = "physics-test";

const engines: GwenEngine[] = [];

afterEach(async () => {
  const pending = engines.splice(0);
  for (const engine of pending) await engine.stop();
});

async function openEngine(): Promise<GwenEngine> {
  const engine = await createEngine({ maxEntities: 8 });
  engines.push(engine);
  return engine;
}

function write16(
  view: DataView,
  index: number,
  slotA: number,
  slotB: number,
  flags: number,
  colA: number,
  colB: number,
): void {
  const base = index * 16;
  view.setUint32(base, slotA, true);
  view.setUint32(base + 4, slotB, true);
  view.setUint32(base + 8, flags, true);
  view.setUint16(base + 12, colA, true);
  view.setUint16(base + 14, colB, true);
}

function write20(
  view: DataView,
  index: number,
  slotA: number,
  slotB: number,
  colA: number,
  colB: number,
  flags: number,
): void {
  const base = index * 20;
  view.setUint32(base, slotA, true);
  view.setUint32(base + 4, slotB, true);
  view.setUint32(base + 8, colA, true);
  view.setUint32(base + 12, colB, true);
  view.setUint8(base + 16, flags);
}

interface PackedFrame {
  readonly view: DataView;
  readonly count: number;
}

interface SensorRead {
  read(entityId: bigint, sensorId: number): SensorState;
  update?(entityId: bigint, sensorId: number, started: boolean): void;
}

interface Harness {
  frames: Array<PackedFrame | undefined>;
  owners: Map<number, bigint>;
  sensors: Map<number, number>;
  order: string[];
  contactBatches: CollisionContact[][];
  adapter: {
    readonly dim: "2d";
    readonly api: { readonly marker: string };
    readonly eventLayout: CollisionEventLayout;
    step(dt: number): void;
    eventView(): PackedFrame | undefined;
    resolveEntity(slot: number): bigint | undefined;
    resolveSensorId(slot: number, reportedId: number | undefined): number | undefined;
    onEntityDestroy(entityId: bigint): void;
    dispose(): void;
    onContacts(contacts: readonly CollisionContact[]): void;
  };
}

function harness(eventLayout: CollisionEventLayout): Harness {
  const frames: Array<PackedFrame | undefined> = [];
  const owners = new Map<number, bigint>();
  const sensors = new Map<number, number>();
  const order: string[] = [];
  const contactBatches: CollisionContact[][] = [];
  const adapter = {
    dim: "2d" as const,
    api: { marker: "events" },
    eventLayout,
    step(_dt: number) {},
    eventView(): PackedFrame | undefined {
      return frames.shift();
    },
    resolveEntity(slot: number): bigint | undefined {
      return owners.get(slot);
    },
    resolveSensorId(slot: number, reportedId: number | undefined): number | undefined {
      if (reportedId === undefined) return undefined;
      const accepted = sensors.get(slot);
      if (accepted !== reportedId) return undefined;
      return accepted;
    },
    onEntityDestroy(_entityId: bigint) {},
    dispose() {},
    onContacts(contacts: readonly CollisionContact[]) {
      order.push("onContacts");
      contactBatches.push([...contacts]);
    },
  };
  return { frames, owners, sensors, order, contactBatches, adapter };
}

const LAYOUT_16: CollisionEventLayout = { stride: 16, idWidth: 2 };
const LAYOUT_20: CollisionEventLayout = { stride: 20, idWidth: 4 };

function frame16(
  rows: ReadonlyArray<readonly [number, number, number, number, boolean]>,
): PackedFrame {
  const view = new DataView(new ArrayBuffer(rows.length * 16));
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (row === undefined) continue;
    write16(view, index, row[0], row[1], row[4] ? 1 : 0, row[2], row[3]);
  }
  return { view, count: rows.length };
}

function frame20(
  rows: ReadonlyArray<readonly [number, number, number, number, boolean]>,
): PackedFrame {
  const view = new DataView(new ArrayBuffer(rows.length * 20));
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (row === undefined) continue;
    write20(view, index, row[0], row[1], row[2], row[3], row[4] ? 1 : 0);
  }
  return { view, count: rows.length };
}

async function usePlugin(
  engine: GwenEngine,
  name: string,
  box: Harness,
  capture?: (sensors: SensorRead | undefined) => void,
): Promise<void> {
  const plugin = api.createPhysicsPlugin(
    name,
    SERVICE_KEY,
    (_engine, _config, ctx) => {
      capture?.(ctx?.sensors);
      return box.adapter;
    },
    { defaults: {} },
  )();
  await engine.use(plugin);
}

async function listenContacts(
  engine: GwenEngine,
  into: CollisionContact[],
  order?: string[],
): Promise<void> {
  await engine.run(() => {
    api.onContact((contact) => {
      order?.push("onContact");
      into.push(contact);
    });
  });
}

async function update(engine: GwenEngine): Promise<void> {
  await engine.hooks.callHook("engine:update", 0.016);
}

it("dispatches contacts on engine:update through the per-engine registry", async () => {
  const engine = await openEngine();
  const box = harness(LAYOUT_16);
  await usePlugin(engine, "dispatch-plugin", box);
  const entityA = engine.createEntity();
  const entityB = engine.createEntity();
  box.owners.set(1, entityA);
  box.owners.set(2, entityB);
  const received: CollisionContact[] = [];
  await listenContacts(engine, received);
  box.frames.push(frame16([[1, 2, 7, 8, true]]));
  await update(engine);
  expect(received.length).toBe(1);
  expect(received[0]).toEqual({
    entityA,
    entityB,
    aColliderId: 7,
    bColliderId: 8,
    started: true,
  });
});

it("two engines dispatch to their own callbacks", async () => {
  const engineA = await openEngine();
  const engineB = await openEngine();
  const boxes: Harness[] = [];
  const factory = api.createPhysicsPlugin(
    "two-engines",
    SERVICE_KEY,
    () => {
      const box = harness(LAYOUT_16);
      boxes.push(box);
      return box.adapter;
    },
    { defaults: {} },
  );
  await engineA.use(factory());
  await engineB.use(factory());
  const boxA = boxes[0];
  const boxB = boxes[1];
  const entityA1 = engineA.createEntity();
  const entityA2 = engineA.createEntity();
  const entityB1 = engineB.createEntity();
  const entityB2 = engineB.createEntity();
  boxA?.owners.set(1, entityA1);
  boxA?.owners.set(2, entityA2);
  boxB?.owners.set(1, entityB1);
  boxB?.owners.set(2, entityB2);
  const receivedA: CollisionContact[] = [];
  const receivedB: CollisionContact[] = [];
  await listenContacts(engineA, receivedA);
  await listenContacts(engineB, receivedB);
  boxA?.frames.push(frame16([[1, 2, 5, 6, true]]));
  boxB?.frames.push({ view: new DataView(new ArrayBuffer(0)), count: 0 });
  await update(engineA);
  await update(engineB);
  expect(receivedA.length).toBe(1);
  expect(receivedA[0]).toEqual({
    entityA: entityA1,
    entityB: entityA2,
    aColliderId: 5,
    bColliderId: 6,
    started: true,
  });
  expect(receivedB.length).toBe(0);
});

it("physics:collision receives the resolved contacts", async () => {
  const engine = await openEngine();
  const box = harness(LAYOUT_16);
  await usePlugin(engine, "collision-hook-plugin", box);
  const entityA = engine.createEntity();
  const entityB = engine.createEntity();
  box.owners.set(1, entityA);
  box.owners.set(2, entityB);
  box.sensors.set(1, 4);
  const order: string[] = [];
  const batches: CollisionContact[][] = [];
  engine.hooks.hook("physics:sensor:changed", () => {
    order.push("sensor");
  });
  engine.hooks.hook("physics:collision", (contacts) => {
    order.push("collision");
    batches.push([...contacts]);
  });
  const received: CollisionContact[] = [];
  await listenContacts(engine, received, order);
  box.frames.push(frame16([[1, 2, 4, 9, true]]));
  await update(engine);
  expect(batches.length).toBe(1);
  expect(batches[0]).toEqual([
    {
      entityA,
      entityB,
      aColliderId: 4,
      bColliderId: 9,
      started: true,
    },
  ]);
  expect(order).toEqual(["sensor", "collision", "onContact"]);
});

it("reads the 20-byte layout when the adapter declares it", async () => {
  const engine = await openEngine();
  const box = harness(LAYOUT_20);
  await usePlugin(engine, "layout-20-plugin", box);
  const entityA = engine.createEntity();
  const entityB = engine.createEntity();
  box.owners.set(1, entityA);
  box.owners.set(2, entityB);
  const received: CollisionContact[] = [];
  await listenContacts(engine, received);
  box.frames.push(frame20([[1, 2, 0xffffffff, 9, true]]));
  await update(engine);
  expect(received.length).toBe(1);
  const contact = received[0];
  expect(contact?.entityA).toBe(entityA);
  expect(contact?.entityB).toBe(entityB);
  expect(contact?.started).toBe(true);
  expect(contact === undefined ? true : Object.hasOwn(contact, "aColliderId")).toBe(false);
  expect(contact?.bColliderId).toBe(9);
});

it("a slot with no owner is skipped", async () => {
  const engine = await openEngine();
  const box = harness(LAYOUT_16);
  await usePlugin(engine, "ownerless-plugin", box);
  const entityA = engine.createEntity();
  const entityB = engine.createEntity();
  const entityC = engine.createEntity();
  box.owners.set(1, entityA);
  box.owners.set(2, entityB);
  box.owners.set(3, entityC);
  const received: CollisionContact[] = [];
  await listenContacts(engine, received);
  box.frames.push(
    frame16([
      [1, 2, 1, 2, true],
      [3, 4, 3, 4, true],
    ]),
  );
  await update(engine);
  expect(received.length).toBe(1);
  expect(received[0]).toEqual({
    entityA,
    entityB,
    aColliderId: 1,
    bColliderId: 2,
    started: true,
  });
});

it("a frame with count 0 emits nothing", async () => {
  const engine = await openEngine();
  const box = harness(LAYOUT_16);
  await usePlugin(engine, "empty-frame-plugin", box);
  const entityA = engine.createEntity();
  const entityB = engine.createEntity();
  box.owners.set(1, entityA);
  box.owners.set(2, entityB);
  const received: CollisionContact[] = [];
  await listenContacts(engine, received);
  let collisionCalls = 0;
  engine.hooks.hook("physics:collision", () => {
    collisionCalls += 1;
  });
  box.frames.push(undefined);
  await update(engine);
  box.frames.push({ view: new DataView(new ArrayBuffer(0)), count: 0 });
  await update(engine);
  expect(received.length).toBe(0);
  expect(collisionCalls).toBe(0);
  expect(box.contactBatches.length).toBe(0);
  box.frames.push(frame16([[1, 2, 7, 8, true]]));
  await update(engine);
  expect(received.length).toBe(1);
  expect(received[0]).toEqual({
    entityA,
    entityB,
    aColliderId: 7,
    bColliderId: 8,
    started: true,
  });
});

it("a sensor enter and exit fire once per transition", async () => {
  const engine = await openEngine();
  const box = harness(LAYOUT_16);
  await usePlugin(engine, "sensor-transition-plugin", box);
  const entityA = engine.createEntity();
  const entityB = engine.createEntity();
  box.owners.set(1, entityA);
  box.owners.set(2, entityB);
  box.sensors.set(1, 4);
  const entered: bigint[] = [];
  const exited: bigint[] = [];
  await engine.run(() => {
    api.onSensorEnter(4, (entityId) => {
      entered.push(entityId);
    });
    api.onSensorExit(4, (entityId) => {
      exited.push(entityId);
    });
  });
  const sensorHooks: Array<{ entityId: bigint; sensorId: number; state: SensorState }> = [];
  engine.hooks.hook("physics:sensor:changed", (entityId, sensorId, state) => {
    sensorHooks.push({
      entityId,
      sensorId,
      state: { contactCount: state.contactCount, isActive: state.isActive },
    });
  });
  box.frames.push(
    frame16([
      [1, 2, 4, 1, true],
      [1, 2, 4, 1, true],
    ]),
  );
  await update(engine);
  expect(sensorHooks).toEqual([
    { entityId: entityA, sensorId: 4, state: { contactCount: 1, isActive: true } },
  ]);
  expect(entered).toEqual([entityA]);
  expect(exited).toEqual([]);
  box.frames.push(frame16([[1, 2, 4, 1, false]]));
  await update(engine);
  expect(exited).toEqual([]);
  expect(sensorHooks.length).toBe(1);
  box.frames.push(frame16([[1, 2, 4, 1, false]]));
  await update(engine);
  expect(exited).toEqual([entityA]);
  expect(sensorHooks).toEqual([
    { entityId: entityA, sensorId: 4, state: { contactCount: 1, isActive: true } },
    { entityId: entityA, sensorId: 4, state: { contactCount: 0, isActive: false } },
  ]);
  box.frames.push(frame16([[1, 2, 4, 1, false]]));
  await update(engine);
  expect(exited).toEqual([entityA]);
  expect(sensorHooks.length).toBe(2);
  box.frames.push(frame16([[1, 2, 4, 1, true]]));
  await update(engine);
  expect(entered).toEqual([entityA, entityA]);
  expect(sensorHooks.length).toBe(3);
  expect(sensorHooks[2]?.state).toEqual({ contactCount: 1, isActive: true });
});

it("an id the adapter does not accept never changes sensor state", async () => {
  const engine = await openEngine();
  const box = harness(LAYOUT_16);
  await usePlugin(engine, "rejected-sensor-plugin", box);
  const entityA = engine.createEntity();
  const entityB = engine.createEntity();
  box.owners.set(1, entityA);
  box.owners.set(2, entityB);
  box.sensors.set(1, 3);
  const entered: bigint[] = [];
  await engine.run(() => {
    api.onSensorEnter(3, (entityId) => {
      entered.push(entityId);
    });
  });
  const changed: bigint[] = [];
  engine.hooks.hook("physics:sensor:changed", (entityId) => {
    changed.push(entityId);
  });
  box.frames.push(frame16([[1, 2, 3, 3, true]]));
  await update(engine);
  expect(entered).toEqual([entityA]);
  expect(changed).toEqual([entityA]);
});

it("a rejected physics:collision handler is reported, not thrown", async () => {
  const engine = await openEngine();
  const box = harness(LAYOUT_16);
  await usePlugin(engine, "reject-plugin", box);
  const entityA = engine.createEntity();
  const entityB = engine.createEntity();
  box.owners.set(1, entityA);
  box.owners.set(2, entityB);
  const events: GwenErrorPayload[] = [];
  const reported = new Promise<void>((resolve) => {
    engine.errors.on((event) => {
      events.push(event);
      if (event.code === "CORE:PLUGIN_RUNTIME_ERROR") resolve();
    });
  });
  engine.hooks.hook("physics:collision", () => Promise.reject(new Error("collision hook failed")));
  box.frames.push(frame16([[1, 2, 7, 8, true]]));
  let threw = false;
  try {
    await update(engine);
  } catch {
    threw = true;
  }
  await reported;
  expect(threw).toBe(false);
  const hit = events.find((event) => event.code === "CORE:PLUGIN_RUNTIME_ERROR");
  expect(hit?.code).toBe("CORE:PLUGIN_RUNTIME_ERROR");
  expect(hit?.message).toBe("collision hook failed");
  expect(hit?.source).toBe("reject-plugin");
});

it("onContacts receives the resolved contacts after the hooks", async () => {
  const engine = await openEngine();
  const box = harness(LAYOUT_16);
  await usePlugin(engine, "on-contacts-plugin", box);
  const entityA = engine.createEntity();
  const entityB = engine.createEntity();
  box.owners.set(1, entityA);
  box.owners.set(2, entityB);
  const received: CollisionContact[] = [];
  await listenContacts(engine, received, box.order);
  box.frames.push(frame16([[1, 2, 7, 8, true]]));
  await update(engine);
  expect(box.order).toEqual(["onContact", "onContacts"]);
  expect(box.contactBatches.length).toBe(1);
  expect(box.contactBatches[0]).toEqual([
    {
      entityA,
      entityB,
      aColliderId: 7,
      bColliderId: 8,
      started: true,
    },
  ]);
  expect(box.contactBatches[0]).toEqual(received);
});

it("makeAdapter receives a sensor tracker that reflects the dispatched transitions", async () => {
  const engine = await openEngine();
  const box = harness(LAYOUT_16);
  let tracker: SensorRead | undefined;
  await usePlugin(engine, "tracker-plugin", box, (sensors) => {
    tracker = sensors;
  });
  const sensors = tracker;
  expect(sensors).toBeDefined();
  expect(typeof sensors?.read).toBe("function");
  const entityA = engine.createEntity();
  const entityB = engine.createEntity();
  box.owners.set(1, entityA);
  box.owners.set(2, entityB);
  box.sensors.set(1, 4);
  box.frames.push(frame16([[1, 2, 4, 1, true]]));
  await update(engine);
  expect(sensors?.read(entityA, 4)).toEqual({ contactCount: 1, isActive: true });
  box.frames.push(frame16([[1, 2, 4, 1, false]]));
  await update(engine);
  expect(sensors?.read(entityA, 4)).toEqual({ contactCount: 0, isActive: false });
});

it("an entity destroyed mid-overlap loses its sensor state", async () => {
  const engine = await openEngine();
  const box = harness(LAYOUT_16);
  let tracker: SensorRead | undefined;
  await usePlugin(engine, "destroy-sensor-plugin", box, (sensors) => {
    tracker = sensors;
  });
  const sensors = tracker;
  const entityA = engine.createEntity();
  const entityB = engine.createEntity();
  box.owners.set(1, entityA);
  box.owners.set(2, entityB);
  box.sensors.set(1, 4);
  const exited: bigint[] = [];
  await engine.run(() => {
    api.onSensorExit(4, (entityId) => {
      exited.push(entityId);
    });
  });
  const changed: bigint[] = [];
  engine.hooks.hook("physics:sensor:changed", (entityId) => {
    changed.push(entityId);
  });
  box.frames.push(frame16([[1, 2, 4, 1, true]]));
  await update(engine);
  expect(sensors?.read(entityA, 4)).toEqual({ contactCount: 1, isActive: true });
  const changedBeforeDestroy = changed.length;
  await engine.hooks.callHook("entity:destroy", entityA);
  expect(sensors?.read(entityA, 4)).toEqual({ contactCount: 0, isActive: false });
  expect(changed.length).toBe(changedBeforeDestroy);
  expect(exited).toEqual([]);
});

it("a sensor transition fires the registry callbacks before the physics:sensor:changed hook", async () => {
  const engine = await openEngine();
  const box = harness(LAYOUT_16);
  await usePlugin(engine, "sensor-order-plugin", box);
  const entityA = engine.createEntity();
  const entityB = engine.createEntity();
  box.owners.set(1, entityA);
  box.owners.set(2, entityB);
  box.sensors.set(1, 4);
  const order: string[] = [];
  await engine.run(() => {
    api.onSensorEnter(4, () => {
      order.push("enter");
    });
    api.onSensorExit(4, () => {
      order.push("exit");
    });
  });
  engine.hooks.hook("physics:sensor:changed", (_entityId, _sensorId, state) => {
    order.push(state.isActive ? "hook-enter" : "hook-exit");
  });
  box.frames.push(frame16([[1, 2, 4, 1, true]]));
  await update(engine);
  expect(order).toEqual(["enter", "hook-enter"]);
  box.frames.push(frame16([[1, 2, 4, 1, false]]));
  await update(engine);
  expect(order).toEqual(["enter", "hook-enter", "exit", "hook-exit"]);
});

it("a frame whose slots have no owner does not call physics:collision or onContacts", async () => {
  const engine = await openEngine();
  const box = harness(LAYOUT_16);
  await usePlugin(engine, "unowned-frame-plugin", box);
  const entityA = engine.createEntity();
  box.owners.set(1, entityA);
  box.sensors.set(1, 4);
  const entered: bigint[] = [];
  await engine.run(() => {
    api.onSensorEnter(4, (entityId) => {
      entered.push(entityId);
    });
  });
  let collisionCalls = 0;
  engine.hooks.hook("physics:collision", () => {
    collisionCalls += 1;
  });
  const received: CollisionContact[] = [];
  await listenContacts(engine, received);
  box.frames.push(frame16([[1, 2, 4, 9, true]]));
  await update(engine);
  expect(entered).toEqual([entityA]);
  expect(collisionCalls).toBe(0);
  expect(received.length).toBe(0);
  expect(box.contactBatches.length).toBe(0);
});

it("a sensor on a slot with no owner never changes state", async () => {
  const engine = await openEngine();
  const box = harness(LAYOUT_16);
  await usePlugin(engine, "unowned-sensor-plugin", box);
  box.sensors.set(4, 4);
  const entered: bigint[] = [];
  await engine.run(() => {
    api.onSensorEnter(4, (entityId) => {
      entered.push(entityId);
    });
  });
  const changed: bigint[] = [];
  engine.hooks.hook("physics:sensor:changed", (entityId) => {
    changed.push(entityId);
  });
  box.frames.push(frame16([[4, 5, 4, 1, true]]));
  await update(engine);
  expect(changed).toEqual([]);
  expect(entered).toEqual([]);
});

it("a rejected physics:sensor:changed handler is reported, not thrown", async () => {
  const engine = await openEngine();
  const box = harness(LAYOUT_16);
  await usePlugin(engine, "reject-sensor-plugin", box);
  const entityA = engine.createEntity();
  const entityB = engine.createEntity();
  box.owners.set(1, entityA);
  box.owners.set(2, entityB);
  box.sensors.set(1, 4);
  const events: GwenErrorPayload[] = [];
  const reported = new Promise<void>((resolve) => {
    engine.errors.on((event) => {
      events.push(event);
      if (event.code === "CORE:PLUGIN_RUNTIME_ERROR") resolve();
    });
  });
  engine.hooks.hook("physics:sensor:changed", () =>
    Promise.reject(new Error("sensor hook failed")),
  );
  box.frames.push(frame16([[1, 2, 4, 1, true]]));
  let threw = false;
  try {
    await update(engine);
  } catch {
    threw = true;
  }
  await reported;
  expect(threw).toBe(false);
  const hit = events.find((event) => event.code === "CORE:PLUGIN_RUNTIME_ERROR");
  expect(hit?.code).toBe("CORE:PLUGIN_RUNTIME_ERROR");
  expect(hit?.message).toBe("sensor hook failed");
  expect(hit?.source).toBe("reject-sensor-plugin");
});

it("a callback that removes an entity's callbacks mid-frame still delivers the contact to the next listener", async () => {
  const engine = await openEngine();
  const box = harness(LAYOUT_16);
  await usePlugin(engine, "remove-mid-frame", box);
  const entityE = engine.createEntity();
  const other = engine.createEntity();
  box.owners.set(1, entityE);
  box.owners.set(2, other);
  const registry = api.createContactRegistry().get(engine);
  expect(typeof registry.removeEntity).toBe("function");
  if (typeof registry.removeEntity !== "function") return;
  const order: string[] = [];
  await engine.run(() => {
    api.onContact(() => {
      order.push("a");
      registry.removeEntity(entityE);
    }, entityE);
    api.onContact(() => {
      order.push("b");
    }, entityE);
  });
  box.frames.push(frame16([[1, 2, 7, 8, true]]));
  await update(engine);
  expect(order).toEqual(["a", "b"]);
  expect(registry.entries.length).toBe(0);
});

it("a manual sensor update is read back and forgotten with the entity", async () => {
  const engine = await openEngine();
  const box = harness(LAYOUT_16);
  let tracker: SensorRead | undefined;
  await usePlugin(engine, "manual-sensor", box, (sensors) => {
    tracker = sensors;
  });
  const sensors = tracker;
  const updateSensor = sensors?.update;
  expect(typeof updateSensor).toBe("function");
  if (typeof updateSensor !== "function" || sensors === undefined) return;
  const entity = engine.createEntity();
  updateSensor(entity, 8, false);
  expect(sensors.read(entity, 8)).toEqual({ contactCount: 0, isActive: false });
  updateSensor(entity, 4, true);
  expect(sensors.read(entity, 4)).toEqual({ contactCount: 1, isActive: true });
  updateSensor(entity, 4, true);
  expect(sensors.read(entity, 4)).toEqual({ contactCount: 2, isActive: true });
  updateSensor(entity, 4, false);
  expect(sensors.read(entity, 4)).toEqual({ contactCount: 1, isActive: true });
  await engine.hooks.callHook("entity:destroy", entity);
  expect(sensors.read(entity, 4)).toEqual({ contactCount: 0, isActive: false });
});

it("a manual sensor update and the dispatch share one count", async () => {
  const engine = await openEngine();
  const box = harness(LAYOUT_16);
  let tracker: SensorRead | undefined;
  await usePlugin(engine, "shared-count", box, (sensors) => {
    tracker = sensors;
  });
  const sensors = tracker;
  const updateSensor = sensors?.update;
  expect(typeof updateSensor).toBe("function");
  if (typeof updateSensor !== "function" || sensors === undefined) return;
  const entityA = engine.createEntity();
  const entityB = engine.createEntity();
  box.owners.set(1, entityA);
  box.owners.set(2, entityB);
  box.sensors.set(1, 4);
  const entered: bigint[] = [];
  await engine.run(() => {
    api.onSensorEnter(4, (entityId) => {
      entered.push(entityId);
    });
    updateSensor(entityA, 4, true);
  });
  expect(entered).toEqual([]);
  expect(sensors.read(entityA, 4)).toEqual({ contactCount: 1, isActive: true });
  box.frames.push(frame16([[1, 2, 4, 1, true]]));
  await update(engine);
  expect(sensors.read(entityA, 4)).toEqual({ contactCount: 2, isActive: true });
  expect(entered).toEqual([]);
});

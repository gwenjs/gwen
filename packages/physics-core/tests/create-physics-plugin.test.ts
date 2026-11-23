/**
 * `createPhysicsPlugin` wires one adapter to the engine that installs it.
 */

import { afterEach, expect, it } from "vitest";
import type { GwenEngine } from "@gwenjs/core";
import { createEngine } from "@gwenjs/core/node";
import { GwenError } from "@gwenjs/schema";
import * as api from "../src/index.js";

const SERVICE_KEY = "physics-test";

const ADAPTER_FAILED = "TEST:ADAPTER_FAILED";
const ADAPTER_FAILED_WHAT = "adapter boom";

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

interface PrefabCall {
  readonly entityId: bigint;
  readonly extensions: object;
}

interface Recording {
  readonly api: { readonly marker: string };
  readonly adapter: {
    readonly dim: "2d";
    readonly api: { readonly marker: string };
    readonly eventLayout: { readonly stride: 16; readonly idWidth: 2 };
    step(dt: number): void;
    eventView(): undefined;
    resolveEntity(slot: number): undefined;
    resolveSensorId(slot: number, reportedId: number | undefined): undefined;
    onPrefab(entityId: bigint, extensions: object): void;
    onEntityDestroy(entityId: bigint): void;
    dispose(): void;
    beginFrame(dt: number): void;
    onContacts(contacts: readonly object[]): void;
  };
  readonly prefabs: PrefabCall[];
  readonly destroys: bigint[];
  readonly steps: number[];
  readonly beginFrames: number[];
  readonly eventViews: number[];
  readonly disposes: number[];
  readonly contacts: object[][];
}

function recording(marker: string): Recording {
  const surface = { marker };
  const prefabs: PrefabCall[] = [];
  const destroys: bigint[] = [];
  const steps: number[] = [];
  const beginFrames: number[] = [];
  const eventViews: number[] = [];
  const disposes: number[] = [];
  const contacts: object[][] = [];
  const adapter = {
    dim: "2d" as const,
    api: surface,
    eventLayout: { stride: 16 as const, idWidth: 2 as const },
    step(dt: number) {
      steps.push(dt);
    },
    eventView() {
      eventViews.push(eventViews.length);
      return undefined;
    },
    resolveEntity(_slot: number) {
      return undefined;
    },
    resolveSensorId(_slot: number, _reportedId: number | undefined) {
      return undefined;
    },
    onPrefab(entityId: bigint, extensions: object) {
      prefabs.push({ entityId, extensions });
    },
    onEntityDestroy(entityId: bigint) {
      destroys.push(entityId);
    },
    dispose() {
      disposes.push(disposes.length);
    },
    beginFrame(dt: number) {
      beginFrames.push(dt);
    },
    onContacts(batch: readonly object[]) {
      contacts.push([...batch]);
    },
  };
  return {
    api: surface,
    adapter,
    prefabs,
    destroys,
    steps,
    beginFrames,
    eventViews,
    disposes,
    contacts,
  };
}

function adapterFailureMessage(): string {
  return `[GWEN] ${ADAPTER_FAILED_WHAT}\nSee https://gwenjs.github.io/gwen/api/errors#test-adapter-failed (${ADAPTER_FAILED})`;
}

it("the plugin object has only name, setup, teardown and the declaration fields", () => {
  expect(typeof api.createPhysicsPlugin).toBe("function");
  const plugin = api.createPhysicsPlugin(
    "named-plugin",
    SERVICE_KEY,
    () => recording("shape").adapter,
    {
      defaults: { a: 1 },
    },
  )();
  expect(Object.keys(plugin)).toEqual(["name", "setup", "teardown", "provides", "validateOptions"]);
  expect(plugin.provides).toEqual([SERVICE_KEY]);
  expect(plugin.name).toBe("named-plugin");
});

it("provides the adapter api under the service key", async () => {
  expect(typeof api.createPhysicsPlugin).toBe("function");
  const engine = await openEngine();
  const record = recording("provided");
  const plugin = api.createPhysicsPlugin("provide-plugin", SERVICE_KEY, () => record.adapter, {
    defaults: {},
  })();
  await engine.use(plugin);
  expect(engine.inject(SERVICE_KEY)).toBe(record.api);
});

it("routes prefab:instantiate, entity:destroy, engine:before-update and engine:update to the adapter", async () => {
  expect(typeof api.createPhysicsPlugin).toBe("function");
  const engine = await openEngine();
  const record = recording("routed");
  const plugin = api.createPhysicsPlugin("route-plugin", SERVICE_KEY, () => record.adapter, {
    defaults: {},
  })();
  await engine.use(plugin);
  const entityId = engine.createEntity();
  const extensions = { physics: { mass: 2 } };
  await engine.hooks.callHook("prefab:instantiate", entityId, extensions);
  await engine.hooks.callHook("entity:destroy", entityId);
  await engine.hooks.callHook("engine:before-update", 0.016);
  await engine.hooks.callHook("engine:update", 0.5);
  expect(record.prefabs.length).toBe(1);
  expect(record.prefabs[0]?.entityId).toBe(entityId);
  expect(record.prefabs[0]?.extensions).toBe(extensions);
  expect(record.destroys).toEqual([entityId]);
  expect(record.steps).toEqual([0.016]);
  expect(record.eventViews.length).toBe(1);
});

it("does not step at dt 0, below 0 or NaN", async () => {
  expect(typeof api.createPhysicsPlugin).toBe("function");
  const engine = await openEngine();
  const record = recording("guard");
  const plugin = api.createPhysicsPlugin("guard-plugin", SERVICE_KEY, () => record.adapter, {
    defaults: {},
  })();
  await engine.use(plugin);
  await engine.hooks.callHook("engine:before-update", 0);
  await engine.hooks.callHook("engine:before-update", -1);
  await engine.hooks.callHook("engine:before-update", Number.NaN);
  expect(record.steps).toEqual([]);
  expect(record.beginFrames).toEqual([0, -1, Number.NaN]);
  await engine.hooks.callHook("engine:before-update", 0.016);
  await engine.hooks.callHook("engine:before-update", Number.MIN_VALUE);
  expect(record.steps).toEqual([0.016, Number.MIN_VALUE]);
  expect(record.beginFrames).toEqual([0, -1, Number.NaN, 0.016, Number.MIN_VALUE]);
});

it("stops reaching the adapter after unuse", async () => {
  expect(typeof api.createPhysicsPlugin).toBe("function");
  const engine = await openEngine();
  const record = recording("removed");
  const plugin = api.createPhysicsPlugin("remove-plugin", SERVICE_KEY, () => record.adapter, {
    defaults: {},
  })();
  await engine.use(plugin);
  const entityId = engine.createEntity();
  const extensions = { physics: { mass: 1 } };
  await engine.hooks.callHook("prefab:instantiate", entityId, extensions);
  await engine.hooks.callHook("entity:destroy", entityId);
  await engine.hooks.callHook("engine:before-update", 0.016);
  await engine.hooks.callHook("engine:update", 0.016);
  await engine.unuse("remove-plugin");
  await engine.hooks.callHook("prefab:instantiate", entityId, extensions);
  await engine.hooks.callHook("entity:destroy", entityId);
  await engine.hooks.callHook("engine:before-update", 0.016);
  await engine.hooks.callHook("engine:update", 0.016);
  expect(record.prefabs.length).toBe(1);
  expect(record.destroys).toEqual([entityId]);
  expect(record.steps).toEqual([0.016]);
  expect(record.eventViews.length).toBe(1);
  expect(record.disposes).toEqual([0]);
});

it("unuse drops the engine's contact and sensor callbacks", async () => {
  expect(typeof api.createPhysicsPlugin).toBe("function");
  const engine = await openEngine();
  const plugin = api.createPhysicsPlugin(
    "contacts-plugin",
    SERVICE_KEY,
    () => recording("contacts").adapter,
    {
      defaults: {},
    },
  )();
  await engine.use(plugin);
  await engine.run(() => {
    api.onContact(() => undefined);
    api.onSensorEnter(api.SENSOR_ID_FOOT, () => undefined);
  });
  expect(api.createContactRegistry().peek(engine)?.entries.length).toBe(1);
  expect(api.createSensorRegistry().peek(engine)?.entries.length).toBe(1);
  await engine.unuse("contacts-plugin");
  expect(api.createContactRegistry().peek(engine)?.entries.length).toBe(0);
  expect(api.createSensorRegistry().peek(engine)?.entries.length).toBe(0);
});

it("two engines step and destroy through their own adapter", async () => {
  expect(typeof api.createPhysicsPlugin).toBe("function");
  const engineA = await openEngine();
  const engineB = await openEngine();
  const records: Recording[] = [];
  const factory = api.createPhysicsPlugin(
    "shared-plugin",
    SERVICE_KEY,
    () => {
      const record = recording(records.length === 0 ? "a" : "b");
      records.push(record);
      return record.adapter;
    },
    { defaults: {} },
  );
  await engineA.use(factory());
  await engineB.use(factory());
  const entityA = engineA.createEntity();
  const entityB = engineB.createEntity();
  await engineA.hooks.callHook("engine:before-update", 0.016);
  await engineA.hooks.callHook("entity:destroy", entityA);
  await engineB.hooks.callHook("engine:before-update", 0.032);
  await engineB.hooks.callHook("entity:destroy", entityB);
  expect(records[0]?.steps).toEqual([0.016]);
  expect(records[0]?.destroys).toEqual([entityA]);
  expect(records[1]?.steps).toEqual([0.032]);
  expect(records[1]?.destroys).toEqual([entityB]);
});

it("a makeAdapter failure reaches engine.use as the original error", async () => {
  expect(typeof api.createPhysicsPlugin).toBe("function");
  const engine = await openEngine();
  const failure = new GwenError(ADAPTER_FAILED, ADAPTER_FAILED_WHAT);
  const reached: string[] = [];
  const plugin = api.createPhysicsPlugin(
    "fail-plugin",
    SERVICE_KEY,
    () => {
      const record = recording("failed");
      record.adapter.step = () => {
        reached.push("step");
      };
      record.adapter.beginFrame = () => {
        reached.push("begin");
      };
      record.adapter.onPrefab = () => {
        reached.push("prefab");
      };
      record.adapter.onEntityDestroy = () => {
        reached.push("destroy");
      };
      record.adapter.eventView = () => {
        reached.push("event");
        return undefined;
      };
      throw failure;
    },
    { defaults: {} },
  )();
  let caught: unknown;
  try {
    await engine.use(plugin);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBe(failure);
  if (!(caught instanceof GwenError)) {
    throw new Error("expected GwenError");
  }
  expect(caught.code).toBe(ADAPTER_FAILED);
  expect(caught.message).toBe(adapterFailureMessage());
  const entityId = engine.createEntity();
  await engine.hooks.callHook("prefab:instantiate", entityId, {});
  await engine.hooks.callHook("entity:destroy", entityId);
  await engine.hooks.callHook("engine:before-update", 0.016);
  await engine.hooks.callHook("engine:update", 0.016);
  expect(reached).toEqual([]);
  expect(engine.tryInject(SERVICE_KEY)).toBeUndefined();
});

it("makeAdapter receives the declaration defaults merged with the caller options", async () => {
  expect(typeof api.createPhysicsPlugin).toBe("function");
  const engine = await openEngine();
  let seen: { readonly a?: number; readonly b?: number } | undefined;
  const plugin = api.createPhysicsPlugin(
    "options-plugin",
    SERVICE_KEY,
    (_engine, config) => {
      seen = config;
      return recording("options").adapter;
    },
    { defaults: { a: 1, b: 2 } },
  )({ b: 3 });
  await engine.use(plugin);
  expect(seen).toEqual({ a: 1, b: 3 });
});

it("validateOptions returns the declaration issues", () => {
  expect(typeof api.createPhysicsPlugin).toBe("function");
  const issues = [
    {
      path: "a",
      expected: "number",
      received: "string",
      owner: "physics-test",
    },
  ];
  const validated = api.createPhysicsPlugin(
    "validate-plugin",
    SERVICE_KEY,
    () => recording("validate").adapter,
    {
      defaults: { a: 1 },
      validate: () => issues,
    },
  )();
  expect(validated.validateOptions()).toBe(issues);

  const plain = api.createPhysicsPlugin(
    "plain-plugin",
    SERVICE_KEY,
    () => recording("plain").adapter,
    {
      defaults: { a: 1 },
    },
  )();
  expect(plain.validateOptions()).toEqual([]);
});

it("stopping the engine with the plugin installed disposes the adapter once", async () => {
  expect(typeof api.createPhysicsPlugin).toBe("function");
  const engine = await openEngine();
  const record = recording("stopped");
  const plugin = api.createPhysicsPlugin("stop-plugin", SERVICE_KEY, () => record.adapter, {
    defaults: {},
  })();
  await engine.use(plugin);
  await engine.stop();
  expect(record.disposes).toEqual([0]);
});

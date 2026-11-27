/**
 * @file Paged entity reads of the dev introspection service, on real WASM (#94, G3).
 *
 * `entities({ offset, limit })` lists awake entities through chunk queries and
 * `entity(id)` reads one entity. A request outside the page bounds throws
 * `CORE:INTROSPECTION_PAGE_INVALID` naming the field and the value.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { GwenIntrospection } from "@gwenjs/schema";

import { defineActor, definePrefab, useActor } from "../../src/actor/index.js";
import { CoreErrorCodes, type EntityId, type GwenEngine } from "../../src/index.js";
import { componentRegistryFor } from "../../src/engine/engine-component-registry.js";
import { setEntityDormant } from "../../src/engine/engine-internals.js";
import { createEngine } from "../../src/node.js";
import { defineComponent, Types } from "../../src/schema.js";
import { createRealEngine, type RealEngineHandle } from "./harness.js";

const Position = defineComponent({
  name: "P94Position",
  schema: { x: Types.f32, y: Types.f32 },
});
const Velocity = defineComponent({
  name: "P94Velocity",
  schema: { x: Types.f32, y: Types.f32 },
});
const Wide = defineComponent({
  name: "P94Wide",
  schema: { big: Types.u64, at: Types.vec2, alive: Types.bool },
});

const Gone = defineComponent({
  name: "P94Gone",
  schema: { big: Types.u64 },
});

function serviceOf(engine: GwenEngine): GwenIntrospection {
  const intro = engine.tryInject("introspection");
  expect(intro).toBeDefined();
  if (intro === undefined) throw new Error("the dev engine has no introspection service");
  return intro;
}

function spawn(engine: GwenEngine, ...defs: ("position" | "velocity")[]): EntityId {
  const id = engine.createEntity();
  for (const def of defs) {
    if (def === "position") engine.addComponent(id, Position, { x: 1, y: 2 });
    else engine.addComponent(id, Velocity, { x: 3, y: 4 });
  }
  return id;
}

function caught(run: () => unknown): unknown {
  try {
    run();
  } catch (error: unknown) {
    return error;
  }
  return undefined;
}

describe.runIf(__GWEN_DEV__)("introspection entities", () => {
  const handles: RealEngineHandle[] = [];
  const engines: GwenEngine[] = [];

  async function open(maxEntities = 64): Promise<RealEngineHandle> {
    handles.push(await createRealEngine({ variant: "light", maxEntities }));
    const handle = handles.at(-1);
    if (handle === undefined) throw new Error("the real engine was not kept");
    return handle;
  }

  async function openWith(maxPageSize: number): Promise<GwenEngine> {
    const engine = await createEngine({ variant: "light", introspection: { maxPageSize } });
    engines.push(engine);
    return engine;
  }

  afterEach(async () => {
    for (const handle of handles) await handle.dispose();
    handles.length = 0;
    for (const engine of engines) await engine.stop();
    engines.length = 0;
  });

  it("[Position, Velocity] entities are listed with equal values", async () => {
    const { engine } = await open();
    const both = spawn(engine, "position", "velocity");
    const onlyPosition = spawn(engine, "position");
    const onlyVelocity = spawn(engine, "velocity");
    const page = serviceOf(engine).entities({ offset: 0, limit: 10 });
    expect(page.available).toBe(true);
    expect(page.total).toBe(3);
    expect(page.listed).toBe(3);
    expect(page.items.map((item) => item.id)).toEqual([both, onlyPosition, onlyVelocity]);
    const types = engine.registeredComponentTypes();
    expect(page.items[0]?.components).toEqual([
      { name: "P94Position", typeId: types.get("P94Position"), values: { x: 1, y: 2 } },
      { name: "P94Velocity", typeId: types.get("P94Velocity"), values: { x: 3, y: 4 } },
    ]);
    expect(page.items[1]?.components.map((entry) => entry.name)).toEqual(["P94Position"]);
    expect(page.items[2]?.components.map((entry) => entry.name)).toEqual(["P94Velocity"]);
    expect(page.items[0]?.actor).toBeUndefined();
  });

  it("zero entities give total 0 listed 0 items []", async () => {
    const { engine } = await open();
    expect(serviceOf(engine).entities({ offset: 0, limit: 5 })).toEqual({
      available: true,
      total: 0,
      listed: 0,
      items: [],
    });
  });

  it("an entity with no component is counted in total and not listed", async () => {
    const { engine } = await open();
    const bare = engine.createEntity();
    const full = spawn(engine, "position");
    const page = serviceOf(engine).entities({ offset: 0, limit: 5 });
    expect(page.total).toBe(2);
    expect(page.listed).toBe(1);
    expect(page.items.map((item) => item.id)).toEqual([full]);
    expect(serviceOf(engine).entity(bare)).toBeUndefined();
  });

  it("a destroyed entity is skipped", async () => {
    const { engine } = await open();
    const first = spawn(engine, "position");
    const middle = spawn(engine, "position", "velocity");
    const last = spawn(engine, "velocity");
    engine.destroyEntity(middle);
    const page = serviceOf(engine).entities({ offset: 0, limit: 10 });
    expect(page.total).toBe(2);
    expect(page.listed).toBe(2);
    expect(page.items.map((item) => item.id)).toEqual([first, last]);
  });

  it("a dormant entity is not listed and entity(id) is undefined for it", async () => {
    const { engine } = await open();
    const awake = spawn(engine, "position");
    const asleep = spawn(engine, "position");
    expect(setEntityDormant(engine, asleep, true)).toBe(true);
    const intro = serviceOf(engine);
    const page = intro.entities({ offset: 0, limit: 10 });
    expect(page.total).toBe(2);
    expect(page.listed).toBe(1);
    expect(page.items.map((item) => item.id)).toEqual([awake]);
    expect(intro.entity(asleep)).toBeUndefined();
    expect(setEntityDormant(engine, asleep, false)).toBe(true);
    expect(intro.entities({ offset: 0, limit: 10 }).listed).toBe(2);
  });

  it("entity(id) returns the components of a live entity", async () => {
    const { engine } = await open();
    const id = spawn(engine, "velocity", "position");
    const found = serviceOf(engine).entity(id);
    expect(found?.id).toBe(id);
    // Components follow the registration order of their types on this engine, not the add order.
    expect(found?.components.map((entry) => entry.name)).toEqual(["P94Velocity", "P94Position"]);
    expect(found?.components[0]?.values).toEqual({ x: 3, y: 4 });
    expect(found?.components[1]?.values).toEqual({ x: 1, y: 2 });
  });

  it("entity(id) is undefined for a dead id", async () => {
    const { engine } = await open();
    const id = spawn(engine, "position");
    expect(serviceOf(engine).entity(id)?.id).toBe(id);
    engine.destroyEntity(id);
    expect(serviceOf(engine).entity(id)).toBeUndefined();
  });

  it("entity(id) gives undefined, never an error, for ids outside the 64-bit range and for non-bigint values", async () => {
    const { engine } = await open();
    const id = spawn(engine, "position");
    const intro = serviceOf(engine);
    expect(intro.entity(id)?.id).toBe(id);
    expect(intro.entity(-1n)).toBeUndefined();
    expect(intro.entity(2n ** 64n)).toBeUndefined();
    expect(intro.entity(2n ** 64n - 1n)).toBeUndefined();
    expect(Reflect.apply(intro.entity, intro, [1])).toBeUndefined();
  });

  it("values keep a bigint field, a vec2 and a bool, and are frozen", async () => {
    const { engine } = await open();
    const id = engine.createEntity();
    engine.addComponent(id, Wide, { big: 7n, at: { x: 5, y: 6 }, alive: true });
    const values = serviceOf(engine).entity(id)?.components[0]?.values;
    expect(values).toEqual({ big: 7n, at: { x: 5, y: 6 }, alive: true });
    expect(Object.isFrozen(values)).toBe(true);
    expect(Object.isFrozen(values?.["at"])).toBe(true);
  });

  it("no engine, service or typed array is reachable from a page", async () => {
    const { engine } = await open();
    const id = engine.createEntity();
    engine.addComponent(id, Wide, { big: 7n, at: { x: 5, y: 6 }, alive: true });
    const intro = serviceOf(engine);
    const page = intro.entities({ offset: 0, limit: 5 });
    expect(page.items).toHaveLength(1);
    const forbidden = new Set<unknown>([
      engine,
      intro,
      engine.inject("logger"),
      engine.inject("memory"),
    ]);
    const seen = new Set<unknown>();
    const stack: unknown[] = [page, intro.entity(id)];
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === null || typeof current !== "object" || seen.has(current)) continue;
      seen.add(current);
      expect(forbidden.has(current)).toBe(false);
      expect(ArrayBuffer.isView(current)).toBe(false);
      for (const value of Object.values(current)) stack.push(value);
    }
    expect(seen.size).toBeGreaterThan(5);
  });

  it("an actor entity carries the id and name of its actor", async () => {
    const { engine } = await open();
    const Hero = defineActor(
      "p94-hero",
      definePrefab([{ def: Position, defaults: { x: 9, y: 8 } }]),
      () => ({}),
    );
    await engine.use(Hero.plugin);
    const hero = engine.run(() => useActor(Hero)).spawn();
    const plain = spawn(engine, "velocity");
    const page = serviceOf(engine).entities({ offset: 0, limit: 10 });
    const withActor = page.items.find((item) => item.id === hero);
    expect(withActor?.actor?.name).toBe("p94-hero");
    expect(withActor?.actor?.id).toMatch(/^actor#\d+$/);
    expect(page.items.find((item) => item.id === plain)?.actor).toBeUndefined();
    const single = serviceOf(engine).entity(hero);
    expect(single?.actor).toEqual(withActor?.actor);
  });

  it("pages are contiguous and ascending by entity index", async () => {
    const { engine } = await open();
    const ids = [1, 2, 3, 4, 5].map(() => spawn(engine, "position"));
    const intro = serviceOf(engine);
    const first = intro.entities({ offset: 0, limit: 2 });
    const second = intro.entities({ offset: 2, limit: 2 });
    const third = intro.entities({ offset: 4, limit: 2 });
    expect([first, second, third].map((page) => page.items.length)).toEqual([2, 2, 1]);
    expect([first, second, third].flatMap((page) => page.items.map((item) => item.id))).toEqual(
      ids,
    );
    expect(first.listed).toBe(5);
    expect(third.listed).toBe(5);
    expect(intro.entities({ offset: 5, limit: 2 }).items).toEqual([]);
    expect(intro.entities({ offset: 5, limit: 2 }).listed).toBe(5);
    expect(intro.entities({ offset: Number.MAX_SAFE_INTEGER, limit: 1 }).items).toEqual([]);
  });

  it("limit 1 returns one item", async () => {
    const { engine } = await open();
    spawn(engine, "position");
    spawn(engine, "position");
    const page = serviceOf(engine).entities({ offset: 0, limit: 1 });
    expect(page.items).toHaveLength(1);
    expect(page.listed).toBe(2);
  });

  it("limit 1000 returns 1000 items", async () => {
    const { engine } = await open(1100);
    for (let n = 0; n < 1100; n += 1) spawn(engine, "position");
    const intro = serviceOf(engine);
    const page = intro.entities({ offset: 0, limit: 1000 });
    expect(page.items).toHaveLength(1000);
    expect(page.listed).toBe(1100);
    expect(intro.entities({ offset: 1000, limit: 1000 }).items).toHaveLength(100);
  });

  it("limit 1001 throws naming limit and 1000", async () => {
    const { engine } = await open();
    spawn(engine, "position");
    const intro = serviceOf(engine);
    expect(intro.entities({ offset: 0, limit: 1000 }).items).toHaveLength(1);
    const error = caught(() => intro.entities({ offset: 0, limit: 1001 }));
    expect(error).toMatchObject({ code: CoreErrorCodes.INTROSPECTION_PAGE_INVALID });
    expect(String(error)).toContain("limit");
    expect(String(error)).toContain("1001");
    expect(String(error)).toContain("1000");
  });

  it('limit 0, -1, 0.5, NaN, Infinity and "5" throw CORE:INTROSPECTION_PAGE_INVALID naming limit', async () => {
    const { engine } = await open();
    const intro = serviceOf(engine);
    expect(intro.entities({ offset: 0, limit: 1 }).available).toBe(true);
    const shown: [unknown, string][] = [
      [0, "0"],
      [-1, "-1"],
      [0.5, "0.5"],
      [Number.NaN, "NaN"],
      [Number.POSITIVE_INFINITY, "Infinity"],
      ["5", '"5"'],
    ];
    for (const [limit, text] of shown) {
      const error = caught(() => Reflect.apply(intro.entities, intro, [{ offset: 0, limit }]));
      expect(error).toMatchObject({ code: "CORE:INTROSPECTION_PAGE_INVALID" });
      expect(String(error)).toContain(`Page limit is ${text}.`);
    }
  });

  it('offset -1, 0.5, NaN, Infinity, 2**53 and "0" throw naming offset; 0 and MAX_SAFE_INTEGER are accepted', async () => {
    const { engine } = await open();
    const intro = serviceOf(engine);
    expect(intro.entities({ offset: 0, limit: 1 }).available).toBe(true);
    expect(intro.entities({ offset: Number.MAX_SAFE_INTEGER, limit: 1 }).available).toBe(true);
    const shown: [unknown, string][] = [
      [-1, "-1"],
      [0.5, "0.5"],
      [Number.NaN, "NaN"],
      [Number.POSITIVE_INFINITY, "Infinity"],
      [Number.MAX_SAFE_INTEGER + 1, String(Number.MAX_SAFE_INTEGER + 1)],
      ["0", '"0"'],
      [undefined, "undefined"],
    ];
    for (const [offset, text] of shown) {
      const error = caught(() => Reflect.apply(intro.entities, intro, [{ offset, limit: 1 }]));
      expect(error).toMatchObject({ code: "CORE:INTROSPECTION_PAGE_INVALID" });
      expect(String(error)).toContain(`Page offset is ${text}.`);
    }
  });

  it("a null page throws naming page", async () => {
    const { engine } = await open();
    const intro = serviceOf(engine);
    expect(intro.entities({ offset: 0, limit: 1 }).available).toBe(true);
    for (const [page, text] of [
      [null, "null"],
      [undefined, "undefined"],
      [5, "5"],
      ["x", '"x"'],
    ] as const) {
      const error = caught(() => Reflect.apply(intro.entities, intro, [page]));
      expect(error).toMatchObject({ code: "CORE:INTROSPECTION_PAGE_INVALID" });
      expect(String(error)).toContain(`Page page is ${text}.`);
    }
  });

  it("offset is reported before limit", async () => {
    const { engine } = await open();
    const intro = serviceOf(engine);
    expect(intro.entities({ offset: 0, limit: 1 }).available).toBe(true);
    const error = caught(() => intro.entities({ offset: -1, limit: 0 }));
    expect(String(error)).toContain("Page offset is -1.");
    expect(String(error)).not.toContain("Page limit");
  });

  it("the error carries the page cap and a Fix line", async () => {
    const { engine } = await open();
    const intro = serviceOf(engine);
    expect(intro.entities({ offset: 0, limit: 1 }).available).toBe(true);
    const error = caught(() => intro.entities({ offset: 0, limit: 5000 }));
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain("[introspection.entities()]");
    expect(String(error)).toContain("Fix:");
    expect(String(error)).toContain("The maximum page size is 1000.");
    expect(error).toMatchObject({ code: "CORE:INTROSPECTION_PAGE_INVALID" });
  });

  it("a faulted engine still validates first, then gives available false", async () => {
    const { engine, bridge } = await open();
    const id = spawn(engine, "position");
    await engine.startExternal();
    const intro = serviceOf(engine);
    expect(intro.entities({ offset: 0, limit: 1 }).available).toBe(true);
    expect(intro.entity(id)).toBeDefined();
    engine.errors.emit({ level: "fatal", code: "TEST:FATAL", message: "down" });
    expect(engine.state).toBe("faulted");
    const error = caught(() => intro.entities({ offset: 0, limit: 0 }));
    expect(error).toMatchObject({ code: "CORE:INTROSPECTION_PAGE_INVALID" });
    const before = bridge.registerQuery(Uint32Array.of(0));
    bridge.releaseQuery(before);
    expect(intro.entities({ offset: 0, limit: 5 })).toEqual({
      available: false,
      total: 0,
      listed: 0,
      items: [],
    });
    expect(intro.entity(id)).toBeUndefined();
    const after = bridge.registerQuery(Uint32Array.of(0));
    bridge.releaseQuery(after);
    expect(after).toBe(before);
  });

  it("a stopped engine gives an empty available page and does not throw", async () => {
    const { engine } = await open();
    const id = spawn(engine, "position");
    const intro = serviceOf(engine);
    expect(intro.entities({ offset: 0, limit: 1 }).listed).toBe(1);
    expect(intro.entity(id)).toBeDefined();
    await engine.stop();
    expect(intro.entities({ offset: 0, limit: 1 })).toEqual({
      available: true,
      total: 0,
      listed: 0,
      items: [],
    });
    expect(intro.entity(id)).toBeUndefined();
  });

  it("a stopped engine that owns its bridge gives an empty page and entity undefined without throwing", async () => {
    const engine = await openWith(1000);
    const id = spawn(engine, "position");
    const intro = serviceOf(engine);
    expect(intro.entity(id)).toBeDefined();
    expect(intro.entities({ offset: 0, limit: 1 }).listed).toBe(1);
    await engine.stop();
    expect(intro.entity(id)).toBeUndefined();
    expect(intro.entities({ offset: 0, limit: 1 })).toEqual({
      available: true,
      total: 0,
      listed: 0,
      items: [],
    });
  });

  it("a same-name definition rejected for other lanes leaves the listing intact", async () => {
    const { engine } = await open();
    const id = spawn(engine, "position");
    const intro = serviceOf(engine);
    const types = engine.registeredComponentTypes();
    const listed = {
      name: "P94Position",
      typeId: types.get("P94Position"),
      values: { x: 1, y: 2 },
    };
    const before = intro.entities({ offset: 0, limit: 10 });
    expect(before.items.map((item) => item.id)).toEqual([id]);
    expect(before.items[0]?.components).toEqual([listed]);
    expect(intro.entity(id)?.components).toEqual([listed]);

    const otherLanes = defineComponent({
      name: "P94Position",
      schema: { x: Types.f64, y: Types.f64 },
    });
    expect(() => engine.addComponent(id, otherLanes, { x: 9, y: 9 })).toThrow(
      expect.objectContaining({ code: "CORE:COMPONENT_LAYOUT_INVALID" }),
    );

    const single = intro.entity(id);
    expect(single?.id).toBe(id);
    expect(single?.components).toEqual([listed]);
    let pageAfter: unknown;
    try {
      pageAfter = intro.entities({ offset: 0, limit: 10 });
    } catch (error: unknown) {
      pageAfter = error;
    }
    expect(pageAfter).toEqual({
      available: true,
      total: 1,
      listed: 1,
      items: [{ id, components: [listed] }],
    });
  });

  it("a configured maxPageSize of 64 accepts 64 and rejects 65", async () => {
    const engine = await openWith(64);
    const intro = serviceOf(engine);
    expect(intro.limits.maxPageSize).toBe(64);
    expect(intro.entities({ offset: 0, limit: 64 }).available).toBe(true);
    const error = caught(() => intro.entities({ offset: 0, limit: 65 }));
    expect(error).toMatchObject({ code: "CORE:INTROSPECTION_PAGE_INVALID" });
    expect(String(error)).toContain("Page limit is 65.");
    expect(String(error)).toContain("The maximum page size is 64.");
  });

  it("two engines keep their own maxPageSize", async () => {
    const small = await openWith(64);
    const large = await openWith(2000);
    expect(serviceOf(large).entities({ offset: 0, limit: 1500 }).available).toBe(true);
    expect(caught(() => serviceOf(small).entities({ offset: 0, limit: 1500 }))).toMatchObject({
      code: "CORE:INTROSPECTION_PAGE_INVALID",
    });
    expect(serviceOf(small).entities({ offset: 0, limit: 64 }).available).toBe(true);
  });

  it("two engines list their own entities", async () => {
    const left = await open();
    const right = await open();
    spawn(left.engine, "position");
    spawn(left.engine, "position");
    spawn(right.engine, "velocity");
    expect(serviceOf(left.engine).entities({ offset: 0, limit: 10 }).listed).toBe(2);
    expect(serviceOf(right.engine).entities({ offset: 0, limit: 10 }).listed).toBe(1);
    expect(
      serviceOf(right.engine).entities({ offset: 0, limit: 10 }).items[0]?.components[0]?.name,
    ).toBe("P94Velocity");
  });

  it("reads leave storage_generation unchanged and fire no hook", async () => {
    const { engine, bridge } = await open();
    const first = spawn(engine, "position", "velocity");
    spawn(engine, "position");
    const intro = serviceOf(engine);
    const fired: string[] = [];
    const stop = engine.hooks.beforeEach((event) => {
      fired.push(event.name);
    });
    const generation = bridge.storageGeneration();
    const total = bridge.countEntities();
    const page = intro.entities({ offset: 0, limit: 10 });
    expect(page.items).toHaveLength(2);
    expect(intro.entity(first)?.components).toHaveLength(2);
    stop();
    expect(bridge.storageGeneration()).toBe(generation);
    expect(bridge.countEntities()).toBe(total);
    expect(fired).toEqual([]);
  });

  it("reads release every chunk query they open", async () => {
    const { engine, bridge } = await open();
    spawn(engine, "position", "velocity");
    const types = engine.registeredComponentTypes();
    const typeId = types.get("P94Position");
    expect(typeId).toBeDefined();
    const probe = (): number => {
      const handle = bridge.registerQuery(Uint32Array.of(typeId ?? 0));
      bridge.releaseQuery(handle);
      return handle;
    };
    const before = probe();
    const intro = serviceOf(engine);
    for (let n = 0; n < 20; n += 1) {
      expect(intro.entities({ offset: 0, limit: 5 }).listed).toBe(1);
    }
    expect(probe()).toBe(before);
  });

  it("a released plugin component later registered by name is not listed with its old definition", async () => {
    const { engine } = await open();
    const plugin = {
      name: "p94-gone",
      setup(eng: GwenEngine) {
        componentRegistryFor(eng).getOrRegister(Gone);
      },
    };
    await engine.use(plugin);
    expect(engine.registeredComponentTypes().get("P94Gone")).toBeDefined();
    await engine.unuse(plugin.name);
    expect(engine.registeredComponentTypes().get("P94Gone")).toBeUndefined();
    engine.getOrRegisterComponent("P94Gone");
    const kept = spawn(engine, "position");
    const page = serviceOf(engine).entities({ offset: 0, limit: 10 });
    expect(page.items.map((item) => item.id)).toEqual([kept]);
    expect(page.items[0]?.components.map((entry) => entry.name)).toEqual(["P94Position"]);
  });
});

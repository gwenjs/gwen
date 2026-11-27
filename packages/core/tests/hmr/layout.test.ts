import { afterEach, describe, expect, it } from "vitest";
import { defineActor } from "../../src/actor/runtime/define-actor";
import { defineLayout } from "../../src/actor/runtime/define-layout";
import { definePrefab } from "../../src/actor/runtime/define-prefab";
import { placeActor } from "../../src/actor/runtime/place";
import { useLayout } from "../../src/actor/runtime/use-layout";
import type { GwenEngine } from "../../src/engine/engine-types.js";
import { hotReplaceLayout } from "../../src/internal.js";
import { createEngine } from "../../src/node.js";
import { defineComponent, Types } from "../../src/schema";
import { onUpdate } from "../../src/system/runtime/define-system";

const engines: GwenEngine[] = [];

async function boot(): Promise<GwenEngine> {
  const engine = await createEngine();
  engines.push(engine);
  return engine;
}

afterEach(async () => {
  for (const engine of engines.splice(0)) await engine.stop();
});

const Hp = defineComponent({ name: "HotLayoutHp", schema: { hp: Types.f32 } });
const Unit = defineActor(
  "LayoutUnit",
  definePrefab([{ def: Hp, defaults: { hp: 1 } }]),
  () => ({}),
);

/** A layout that places one unit under `key`. */
function placing(key: string) {
  return defineLayout(() => ({ [key]: placeActor(Unit, { at: [0, 0] }) }));
}

describe.runIf(__GWEN_DEV__)("hotReplaceLayout", () => {
  it("each loaded handle is disposed and loaded again with the new factory", async () => {
    const engine = await boot();
    await engine.use(Unit._plugin);
    const Level = placing("a");
    const Level2 = placing("b");
    const handle = engine.run(() => useLayout(Level, { lazy: true }));
    await handle.load();
    const oldRef = Object.values(handle.refs)[0];

    const report = await hotReplaceLayout(Level, Level2);

    expect(report).toEqual({ status: "applied", kind: "layout", name: "anonymous", count: 1 });
    expect(Object.keys(handle.refs)).toEqual(["b"]);
    expect(oldRef?.entityId === undefined ? true : engine.isAlive(oldRef.entityId)).toBe(false);
    expect(Object.values(handle.refs).map((ref) => engine.isAlive(ref.entityId))).toEqual([true]);
    expect(Unit._instances.size).toBe(1);
  });

  it("the actors a layout placed are despawned by the swap: no stale instance or handler", async () => {
    const engine = await boot();
    let runs = 0;
    const Ticker = defineActor(
      "LayoutTicker",
      definePrefab([{ def: Hp, defaults: { hp: 1 } }]),
      () => {
        onUpdate(() => {
          runs++;
        });
        return {};
      },
    );
    await engine.use(Ticker._plugin);
    const Level = defineLayout(() => ({ a: placeActor(Ticker, { at: [0, 0] }) }));
    const Level2 = defineLayout(() => ({ a: placeActor(Ticker, { at: [0, 0] }) }));
    const handle = engine.run(() => useLayout(Level, { lazy: true }));
    await handle.load();
    const cold = {
      entityCount: engine.getStats().entityCount,
      hookListeners: engine.getStats().hookListeners,
    };

    const report = await hotReplaceLayout(Level, Level2);
    await engine.advance(0.016);

    expect(report).toEqual({ status: "applied", kind: "layout", name: "anonymous", count: 1 });
    expect(runs).toBe(1);
    expect(Ticker._instances.size).toBe(1);
    expect({
      entityCount: engine.getStats().entityCount,
      hookListeners: engine.getStats().hookListeners,
    }).toEqual(cold);
  });

  it("an unloaded handle is not loaded by the swap", async () => {
    const engine = await boot();
    await engine.use(Unit._plugin);
    const Level = placing("a");
    const Level2 = placing("b");
    const loaded = engine.run(() => useLayout(Level, { lazy: true }));
    const unloaded = engine.run(() => useLayout(Level, { lazy: true }));
    await loaded.load();

    const report = await hotReplaceLayout(Level, Level2);

    expect(report).toEqual({ status: "applied", kind: "layout", name: "anonymous", count: 1 });
    expect(unloaded.active).toBe(false);
    expect(Unit._instances.size).toBe(1);
  });

  it("layout entity ids are not preserved", async () => {
    const engine = await boot();
    await engine.use(Unit._plugin);
    const Level = placing("a");
    const Level2 = placing("a");
    const handle = engine.run(() => useLayout(Level, { lazy: true }));
    await handle.load();
    const before = Object.values(handle.refs).map((ref) => ref.entityId);

    const report = await hotReplaceLayout(Level, Level2);

    expect(report).toEqual({ status: "applied", kind: "layout", name: "anonymous", count: 1 });
    const after = Object.values(handle.refs).map((ref) => ref.entityId);
    expect(after).toHaveLength(1);
    expect(after).not.toEqual(before);
  });

  it("a second swap through next reloads the handle with the last factory", async () => {
    const engine = await boot();
    await engine.use(Unit._plugin);
    const Level = placing("a");
    const V1 = placing("b");
    const V2 = placing("c");
    const handle = engine.run(() => useLayout(Level, { lazy: true }));
    await handle.load();

    const first = await hotReplaceLayout(Level, V1);
    const second = await hotReplaceLayout(V1, V2);

    expect(first).toEqual({ status: "applied", kind: "layout", name: "anonymous", count: 1 });
    expect(second).toEqual({ status: "applied", kind: "layout", name: "anonymous", count: 1 });
    expect(Object.keys(handle.refs)).toEqual(["c"]);
    expect(Unit._instances.size).toBe(1);
  });

  it("a swap to a layout with another name applies with count 0 and keeps the factory", async () => {
    const engine = await boot();
    await engine.use(Unit._plugin);
    const Level = placing("a");
    const Renamed = placing("b");
    Object.defineProperty(Renamed, "__layoutName__", { value: "Renamed" });
    const handle = engine.run(() => useLayout(Level, { lazy: true }));
    await handle.load();

    const report = await hotReplaceLayout(Level, Renamed);

    expect(report).toEqual({ status: "applied", kind: "layout", name: "anonymous", count: 0 });
    expect(Object.keys(handle.refs)).toEqual(["a"]);
  });

  it("a layout nobody loaded applies with count 0", async () => {
    const Level = placing("a");
    const Level2 = placing("b");

    expect(await hotReplaceLayout(Level, Level2)).toEqual({
      status: "applied",
      kind: "layout",
      name: "anonymous",
      count: 0,
    });
  });

  it("a new factory that throws leaves the handle inactive and reports the load failure", async () => {
    const engine = await boot();
    await engine.use(Unit._plugin);
    const events: string[] = [];
    engine.errors.on((event) => {
      events.push(event.code);
    });
    const Level = placing("a");
    const Broken = defineLayout(() => {
      throw new Error("boom");
    });
    const handle = engine.run(() => useLayout(Level, { lazy: true }));
    await handle.load();

    const report = await hotReplaceLayout(Level, Broken);

    expect(report).toEqual({ status: "applied", kind: "layout", name: "anonymous", count: 0 });
    expect(handle.active).toBe(false);
    expect(events).toEqual(["CORE:LAYOUT_LOAD_FAILED"]);
    expect(Unit._instances.size).toBe(0);
  });

  it("a handle made through next after the first swap reloads with the last factory", async () => {
    const engine = await boot();
    await engine.use(Unit._plugin);
    const Level = placing("a");
    const V1 = placing("b");
    const V2 = placing("c");
    const rootHandle = engine.run(() => useLayout(Level, { lazy: true }));
    await rootHandle.load();

    const first = await hotReplaceLayout(Level, V1);
    const handle = engine.run(() => useLayout(V1, { lazy: true }));
    await handle.load();
    const second = await hotReplaceLayout(V1, V2);

    expect(first).toEqual({ status: "applied", kind: "layout", name: "anonymous", count: 1 });
    expect(second).toEqual({ status: "applied", kind: "layout", name: "anonymous", count: 2 });
    expect(Object.keys(handle.refs)).toEqual(["c"]);
  });

  it("a stopped engine does not block the swap of the other engine", async () => {
    const live = await boot();
    const stopped = await boot();
    await live.use(Unit._plugin);
    await stopped.use(Unit._plugin);
    const Level = placing("a");
    const Level2 = placing("b");
    const liveHandle = live.run(() => useLayout(Level, { lazy: true }));
    const stoppedHandle = stopped.run(() => useLayout(Level, { lazy: true }));
    await liveHandle.load();
    await stoppedHandle.load();
    await stopped.stop();

    const report = await hotReplaceLayout(Level, Level2);

    expect(report).toEqual({ status: "applied", kind: "layout", name: "anonymous", count: 1 });
    expect(Object.keys(liveHandle.refs)).toEqual(["b"]);
  });

  it("two engines both reload their handle", async () => {
    const first = await boot();
    const second = await boot();
    await first.use(Unit._plugin);
    await second.use(Unit._plugin);
    const Level = placing("a");
    const Level2 = placing("b");
    const handleA = first.run(() => useLayout(Level, { lazy: true }));
    const handleB = second.run(() => useLayout(Level, { lazy: true }));
    await handleA.load();
    await handleB.load();

    const report = await hotReplaceLayout(Level, Level2);

    expect(report).toEqual({ status: "applied", kind: "layout", name: "anonymous", count: 2 });
    expect(Object.keys(handleA.refs)).toEqual(["b"]);
    expect(Object.keys(handleB.refs)).toEqual(["b"]);
  });
});

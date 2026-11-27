import { afterEach, describe, expect, it } from "vitest";
import {
  defineActor,
  onDestroy,
  onReset,
  onStart,
  useEntityId,
} from "../../src/actor/runtime/define-actor";
import { definePrefab } from "../../src/actor/runtime/define-prefab";
import { defineActorPool } from "../../src/actor/runtime/pool/define-actor-pool";
import { useActorPool } from "../../src/actor/runtime/pool/use-actor-pool";
import { useActor } from "../../src/actor/runtime/use-actor";
import { useChildren } from "../../src/actor/runtime/use-children";
import type { GwenEngine } from "../../src/engine/engine-types.js";
import { hotReplaceActor } from "../../src/internal.js";
import { createEngine } from "../../src/node.js";
import { defineComponent, Types } from "../../src/schema";
import {
  defineSystem,
  onBeforeUpdate,
  onUpdate,
  useQuery,
} from "../../src/system/runtime/define-system";

const engines: GwenEngine[] = [];

async function boot(): Promise<GwenEngine> {
  const engine = await createEngine();
  engines.push(engine);
  return engine;
}

afterEach(async () => {
  for (const engine of engines.splice(0)) await engine.stop();
});

const Hp = defineComponent({ name: "HotHp", schema: { hp: Types.f32 } });
const Mp = defineComponent({ name: "HotMp", schema: { mp: Types.f32 } });
const HpPrefab = definePrefab([{ def: Hp, defaults: { hp: 10 } }]);

interface Tagged {
  tag: string;
}

/** An actor whose public API is its tag, so a test can tell which factory built an instance. */
function tagged(name: string, tag: string) {
  return defineActor(name, HpPrefab, (): Tagged => ({ tag }));
}

describe.runIf(__GWEN_DEV__)("hotReplaceActor", () => {
  it("every live instance keeps its EntityId and component values after the swap", async () => {
    const engine = await boot();
    const Unit = tagged("Unit", "old");
    const Unit2 = tagged("Unit", "new");
    await engine.use(Unit._plugin);
    const ids = [Unit._plugin.spawn(), Unit._plugin.spawn(), Unit._plugin.spawn()];
    ids.forEach((id, i) => engine.addComponent(id, Hp, { hp: 100 + i }));

    const report = await hotReplaceActor(Unit, Unit2);

    expect(report).toEqual({ status: "applied", kind: "actor", name: "Unit", count: 3 });
    expect([...Unit._instances.keys()]).toEqual(ids);
    expect(ids.map((id) => engine.getComponent(id, Hp)?.hp)).toEqual([100, 101, 102]);
    expect(ids.map((id) => Unit._instances.get(id)?.api)).toEqual([
      { tag: "new" },
      { tag: "new" },
      { tag: "new" },
    ]);
  });

  it("the new factory receives the stored props", async () => {
    const engine = await boot();
    const seen: unknown[] = [];
    const Unit = defineActor("Unit", HpPrefab, (_props: { hp: number }) => ({}));
    const Unit2 = defineActor("Unit", HpPrefab, (props: { hp: number }) => {
      seen.push(props);
      engine.addComponent(useEntityId(), Hp, { hp: props.hp });
      return {};
    });
    await engine.use(Unit._plugin);
    const id = Unit._plugin.spawn({ hp: 7 });

    const report = await hotReplaceActor(Unit, Unit2);

    expect(report).toEqual({ status: "applied", kind: "actor", name: "Unit", count: 1 });
    expect(seen).toEqual([{ hp: 7 }]);
    expect(engine.getComponent(id, Hp)?.hp).toBe(7);
  });

  it("a factory that spawns children does not duplicate them after the swap", async () => {
    const engine = await boot();
    const Child = tagged("Child", "child");
    const parent = (tag: string) =>
      defineActor("Parent", HpPrefab, () => {
        const children = useChildren();
        onStart(() => {
          children.add(Child);
        });
        return { tag };
      });
    const Parent = parent("old");
    const Parent2 = parent("new");
    await engine.use(Child._plugin);
    await engine.use(Parent._plugin);
    Parent._plugin.spawn();
    Parent._plugin.spawn();
    const before = engine.getStats().entityCount;

    const report = await hotReplaceActor(Parent, Parent2);

    expect(report).toEqual({ status: "applied", kind: "actor", name: "Parent", count: 2 });
    expect(Child._instances.size).toBe(2);
    expect(engine.getStats().entityCount).toBe(before);
  });

  it("children are not duplicated on every engine when two engines are swapped", async () => {
    const first = await boot();
    const second = await boot();
    const Child = tagged("Child", "child");
    const parent = () =>
      defineActor("Parent", HpPrefab, () => {
        const children = useChildren();
        onStart(() => {
          children.add(Child);
        });
        return {};
      });
    const Parent = parent();
    const Parent2 = parent();
    await first.use(Child._plugin);
    await second.use(Child._plugin);
    await first.use(Parent._plugin);
    await second.use(Parent._plugin);
    first.run(() => Parent._plugin.spawn());
    second.run(() => Parent._plugin.spawn());
    const firstChildren = first.run(() => Child._instances.size);
    const secondChildren = second.run(() => Child._instances.size);
    const firstEntities = first.getStats().entityCount;
    const secondEntities = second.getStats().entityCount;

    const report = await hotReplaceActor(Parent, Parent2);

    expect(report).toEqual({ status: "applied", kind: "actor", name: "Parent", count: 2 });
    expect(first.run(() => Child._instances.size)).toBe(firstChildren);
    expect(second.run(() => Child._instances.size)).toBe(secondChildren);
    expect(first.getStats().entityCount).toBe(firstEntities);
    expect(second.getStats().entityCount).toBe(secondEntities);
  });

  it("onDestroy of the old factory runs once per instance", async () => {
    const engine = await boot();
    const destroyed: bigint[] = [];
    const Unit = defineActor("Unit", HpPrefab, () => {
      const id = useEntityId();
      onDestroy(() => {
        destroyed.push(id);
      });
      return {};
    });
    const Unit2 = defineActor("Unit", HpPrefab, () => ({}));
    await engine.use(Unit._plugin);
    const ids = [Unit._plugin.spawn(), Unit._plugin.spawn()];

    const report = await hotReplaceActor(Unit, Unit2);
    ids.forEach((id) => Unit._plugin.despawn(id));

    expect(report).toEqual({ status: "applied", kind: "actor", name: "Unit", count: 2 });
    expect(destroyed).toEqual(ids);
  });

  it("onStart of the new factory runs once per live instance, after its setup", async () => {
    const engine = await boot();
    const order: string[] = [];
    const Unit = defineActor("Unit", HpPrefab, () => ({}));
    const Unit2 = defineActor("Unit", HpPrefab, () => {
      order.push("setup");
      onStart(() => {
        order.push("start");
      });
      return {};
    });
    await engine.use(Unit._plugin);
    Unit._plugin.spawn();
    Unit._plugin.spawn();

    const report = await hotReplaceActor(Unit, Unit2);

    expect(report).toEqual({ status: "applied", kind: "actor", name: "Unit", count: 2 });
    expect(order).toEqual(["setup", "start", "setup", "start"]);
  });

  it("spawnOnce is not duplicated", async () => {
    const engine = await boot();
    const Unit = tagged("Unit", "old");
    const Unit2 = tagged("Unit", "new");
    await engine.use(Unit._plugin);
    const handle = engine.run(() => useActor(Unit));
    const id = handle.spawnOnce();

    const report = await hotReplaceActor(Unit, Unit2);

    expect(report).toEqual({ status: "applied", kind: "actor", name: "Unit", count: 1 });
    expect(handle.spawnOnce()).toBe(id);
    expect(Unit._instances.size).toBe(1);
  });

  it("a dormant pooled instance stays dormant and onReset is not called", async () => {
    const engine = await boot();
    const resets: string[] = [];
    const ticks: bigint[] = [];
    const started: bigint[] = [];
    const unit = (tag: string) =>
      defineActor("Unit", HpPrefab, () => {
        const id = useEntityId();
        onStart(() => {
          started.push(id);
        });
        onUpdate(() => {
          ticks.push(id);
        });
        onReset(() => {
          resets.push(tag);
        });
        return {};
      });
    const Unit = unit("old");
    const Unit2 = unit("new");
    await engine.use(Unit._plugin);
    const definition = defineActorPool(Unit, { size: 2 });
    await engine.use(definition.plugin);
    const pool = engine.run(() => useActorPool(definition));
    const seen: bigint[] = [];
    await engine.use(
      defineSystem("hot-dormant-probe", () => {
        const query = useQuery([Hp]);
        onUpdate(() => {
          seen.length = 0;
          for (const entity of query.each()) seen.push(entity.id);
        });
      })(),
    );
    const first = pool.acquire();
    const second = pool.acquire();
    pool.release(first);
    await engine.advance(0.016);
    ticks.length = 0;
    started.length = 0;

    const report = await hotReplaceActor(Unit, Unit2);
    await engine.advance(0.016);

    expect(report).toEqual({ status: "applied", kind: "actor", name: "Unit", count: 2 });
    expect(ticks).toEqual([second]);
    expect(resets).toEqual([]);
    expect(seen).toEqual([second]);
    expect(started).toEqual([second]);
    expect(pool.acquire()).toBe(first);
    expect(resets).toEqual(["new"]);
  });

  it("a pooled instance reused before the swap gets the props of its last acquire", async () => {
    const engine = await boot();
    const seen: unknown[] = [];
    const Unit = defineActor("Unit", HpPrefab, (_props: { n: number }) => ({}));
    const Unit2 = defineActor("Unit", HpPrefab, (props: { n: number }) => {
      seen.push(props);
      return {};
    });
    await engine.use(Unit._plugin);
    const definition = defineActorPool(Unit, { size: 1 });
    await engine.use(definition.plugin);
    const pool = engine.run(() => useActorPool(definition));
    const id = pool.acquire({ n: 1 });
    pool.release(id);
    await engine.advance(0.016);
    expect(pool.acquire({ n: 2 })).toBe(id);

    const report = await hotReplaceActor(Unit, Unit2);

    expect(report).toEqual({ status: "applied", kind: "actor", name: "Unit", count: 1 });
    expect(seen).toEqual([{ n: 2 }]);
  });

  it("components added to the prefab appear with their defaults and existing values are not overwritten", async () => {
    const engine = await boot();
    const Unit = defineActor("Unit", HpPrefab, () => ({}));
    const Unit2 = defineActor(
      "Unit",
      definePrefab([
        { def: Hp, defaults: { hp: 99 } },
        { def: Mp, defaults: { mp: 5 } },
      ]),
      () => ({}),
    );
    await engine.use(Unit._plugin);
    const id = Unit._plugin.spawn();
    engine.addComponent(id, Hp, { hp: 42 });

    const report = await hotReplaceActor(Unit, Unit2);

    expect(report).toEqual({ status: "applied", kind: "actor", name: "Unit", count: 1 });
    expect(engine.getComponent(id, Mp)?.mp).toBe(5);
    expect(engine.getComponent(id, Hp)?.hp).toBe(42);
  });

  it("a component removed from the prefab stays on the entity", async () => {
    const engine = await boot();
    const Unit = defineActor("Unit", HpPrefab, () => ({}));
    const Unit2 = defineActor("Unit", definePrefab([{ def: Mp, defaults: { mp: 5 } }]), () => ({}));
    await engine.use(Unit._plugin);
    const id = Unit._plugin.spawn();
    engine.addComponent(id, Hp, { hp: 42 });

    const report = await hotReplaceActor(Unit, Unit2);

    expect(report).toEqual({ status: "applied", kind: "actor", name: "Unit", count: 1 });
    expect(engine.hasComponent(id, Hp)).toBe(true);
    expect(engine.getComponent(id, Hp)?.hp).toBe(42);
    expect(engine.getComponent(id, Mp)?.mp).toBe(5);
  });

  it("a throwing new factory isolates that instance and the others continue", async () => {
    const engine = await boot();
    const events: Array<{ code: string; kind: string | undefined; entityId: bigint | undefined }> =
      [];
    engine.errors.on((event) => {
      events.push({
        code: event.code,
        kind: event.target?.kind,
        entityId: event.target?.entityId,
      });
    });
    const runs: number[] = [];
    const Unit = defineActor("Unit", HpPrefab, (_props: { n: number }) => ({}));
    const Unit2 = defineActor("Unit", HpPrefab, (props: { n: number }) => {
      if (props.n === 1) throw new Error("boom");
      onUpdate(() => {
        runs.push(props.n);
      });
      return {};
    });
    await engine.use(Unit._plugin);
    const bad = Unit._plugin.spawn({ n: 1 });
    Unit._plugin.spawn({ n: 2 });

    const report = await hotReplaceActor(Unit, Unit2);
    await engine.advance(0.016);

    expect(report).toEqual({ status: "applied", kind: "actor", name: "Unit", count: 1 });
    expect(events).toEqual([{ code: "CORE:PLUGIN_RUNTIME_ERROR", kind: "actor", entityId: bad }]);
    expect(engine.isolated().map((target) => target.entityId)).toEqual([bad]);
    expect(runs).toEqual([2]);
  });

  it("spawn through prev after the swap uses next's factory", async () => {
    const engine = await boot();
    const Unit = tagged("Unit", "old");
    const Unit2 = tagged("Unit", "new");
    await engine.use(Unit._plugin);
    Unit._plugin.spawn();

    const report = await hotReplaceActor(Unit, Unit2);

    expect(report).toEqual({ status: "applied", kind: "actor", name: "Unit", count: 1 });
    const viaPrev = Unit._plugin.spawn();
    const viaNext = Unit2._plugin.spawn();
    expect(Unit._instances.get(viaPrev)?.api).toEqual({ tag: "new" });
    expect(Unit2._instances.get(viaNext)?.api).toEqual({ tag: "new" });
    expect(Unit2._instances.size).toBe(3);
  });

  it("a useActor handle calls the new public API after the swap", async () => {
    const engine = await boot();
    const who = (tag: string) => defineActor("Unit", HpPrefab, () => ({ who: () => tag }));
    const Unit = who("old");
    const Unit2 = who("new");
    await engine.use(Unit._plugin);
    const handle = engine.run(() => useActor(Unit));
    handle.spawnOnce();
    expect(handle.who()).toBe("old");

    const report = await hotReplaceActor(Unit, Unit2);

    expect(report).toEqual({ status: "applied", kind: "actor", name: "Unit", count: 1 });
    expect(handle.who()).toBe("new");
  });

  it("a handle made through next after the first swap sees the third generation", async () => {
    const engine = await boot();
    const who = (tag: string) => defineActor("Unit", HpPrefab, () => ({ who: () => tag }));
    const Unit = who("v0");
    const V1 = who("v1");
    const V2 = who("v2");
    const V3 = who("v3");
    await engine.use(Unit._plugin);
    Unit._plugin.spawn();

    const first = await hotReplaceActor(Unit, V1);
    expect(first).toEqual({ status: "applied", kind: "actor", name: "Unit", count: 1 });
    const handle = engine.run(() => useActor(V1));
    const second = await hotReplaceActor(V1, V2);
    // The second swap fills the method cache. The third has to drop it.
    handle.who();
    const third = await hotReplaceActor(V2, V3);

    expect(second).toEqual({ status: "applied", kind: "actor", name: "Unit", count: 1 });
    expect(third).toEqual({ status: "applied", kind: "actor", name: "Unit", count: 1 });
    expect(handle.who()).toBe("v3");
  });

  it("a second swap through next respawns with the last factory", async () => {
    const engine = await boot();
    const Unit = tagged("Unit", "v0");
    const V1 = tagged("Unit", "v1");
    const V2 = tagged("Unit", "v2");
    await engine.use(Unit._plugin);
    const id = Unit._plugin.spawn();

    const first = await hotReplaceActor(Unit, V1);
    const second = await hotReplaceActor(V1, V2);

    expect(first).toEqual({ status: "applied", kind: "actor", name: "Unit", count: 1 });
    expect(second).toEqual({ status: "applied", kind: "actor", name: "Unit", count: 1 });
    expect(Unit._instances.get(id)?.api).toEqual({ tag: "v2" });
    const spawned = Unit._plugin.spawn();
    expect(Unit._instances.get(spawned)?.api).toEqual({ tag: "v2" });
  });

  it("two engines are both swapped", async () => {
    const first = await boot();
    const second = await boot();
    const Unit = tagged("Unit", "old");
    const Unit2 = tagged("Unit", "new");
    await first.use(Unit._plugin);
    await second.use(Unit._plugin);
    const a = first.run(() => Unit._plugin.spawn());
    const b = second.run(() => Unit._plugin.spawn());

    const report = await hotReplaceActor(Unit, Unit2);

    expect(report).toEqual({ status: "applied", kind: "actor", name: "Unit", count: 2 });
    expect(first.run(() => Unit._instances.get(a)?.api)).toEqual({ tag: "new" });
    expect(second.run(() => Unit._instances.get(b)?.api)).toEqual({ tag: "new" });
  });

  it("50 swaps keep the entity count and the hook counts", async () => {
    const engine = await boot();
    const generation = (n: number) =>
      defineActor("Unit", HpPrefab, () => {
        onBeforeUpdate(() => {});
        onUpdate(() => {});
        return { n };
      });
    let current = generation(0);
    await engine.use(current._plugin);
    const ids = [current._plugin.spawn(), current._plugin.spawn()];
    const cold = {
      entityCount: engine.getStats().entityCount,
      hookListeners: engine.getStats().hookListeners,
      plugins: engine.getStats().plugins,
    };

    let last: Awaited<ReturnType<typeof hotReplaceActor>> | undefined;
    for (let n = 1; n <= 50; n++) {
      const next = generation(n);
      last = await hotReplaceActor(current, next);
      current = next;
      await engine.advance(0.016);
    }

    expect(last).toEqual({ status: "applied", kind: "actor", name: "Unit", count: 2 });
    expect([...current._instances.values()].map((instance) => instance.api)).toEqual([
      { n: 50 },
      { n: 50 },
    ]);
    expect([...current._instances.keys()]).toEqual(ids);
    expect({
      entityCount: engine.getStats().entityCount,
      hookListeners: engine.getStats().hookListeners,
      plugins: engine.getStats().plugins,
    }).toEqual(cold);
  });

  it("swapping an uninstalled definition applies with count 0", async () => {
    const Ghost = tagged("Ghost", "old");
    const Ghost2 = tagged("Ghost", "new");

    expect(await hotReplaceActor(Ghost, Ghost2)).toEqual({
      status: "applied",
      kind: "actor",
      name: "Ghost",
      count: 0,
    });
    expect(Ghost2._plugin).not.toBe(Ghost._plugin);
  });

  it("a swap to an actor with another name applies with count 0 and leaves the instances", async () => {
    const engine = await boot();
    const Unit = tagged("Unit", "old");
    const Renamed = tagged("Renamed", "new");
    await engine.use(Unit._plugin);
    const id = Unit._plugin.spawn();

    const report = await hotReplaceActor(Unit, Renamed);

    expect(report).toEqual({ status: "applied", kind: "actor", name: "Unit", count: 0 });
    expect(Unit._instances.get(id)?.api).toEqual({ tag: "old" });
  });

  it("a non-running state returns reload engine-not-running", async () => {
    const engine = await boot();
    const Unit = tagged("Unit", "old");
    const Unit2 = tagged("Unit", "new");
    await engine.use(Unit._plugin);
    Unit._plugin.spawn();

    const stopping = engine.stop();
    const report = await hotReplaceActor(Unit, Unit2);
    await stopping;

    expect(report).toEqual({
      status: "reload",
      kind: "actor",
      name: "Unit",
      reason: "engine-not-running",
    });
  });
});

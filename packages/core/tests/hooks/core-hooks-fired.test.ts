import { describe, expect, it } from "vitest";

import {
  CoreErrorCodes,
  createEngine,
  createEntityId,
  defineComponent,
  GwenWasmError,
  Types,
  useEngine,
  type EntityId,
  type GwenEngine,
} from "../../src/index";
import { entityIndex } from "../../src/types/entity.js";
import {
  defineActor,
  defineActorPool,
  defineLayout,
  definePrefab,
  placeActor,
  placeGroup,
  placePrefab,
  useLayout,
  usePrefab,
} from "../../src/actor/index";
import { useQuery } from "../../src/system/index";

const Marker = defineComponent({
  name: "CoreHookFired278",
  schema: { x: Types.f32 },
  defaults: { x: 0 },
});

const plain = definePrefab([{ def: Marker, defaults: { x: 1 } }]);
const labeled = definePrefab([{ def: Marker, defaults: { x: 1 } }], {
  extensions: { label: "box" },
});

async function withEngine(
  maxEntities: number,
  run: (engine: GwenEngine, offs: Array<() => void>) => Promise<void> | void,
): Promise<void> {
  const engine = await createEngine({ maxEntities });
  const offs: Array<() => void> = [];
  try {
    await run(engine, offs);
  } finally {
    for (const off of offs) off();
    await engine.stop();
  }
}

describe("core hooks fired", () => {
  it("entity:spawn fires once with its payload", async () => {
    await withEngine(16, (engine, offs) => {
      const seen: EntityId[] = [];
      let current: GwenEngine | undefined;
      offs.push(
        engine.hooks.hook("entity:spawn", (id) => {
          seen.push(id);
          current = useEngine();
        }),
      );
      const id = engine.createEntity();
      expect(seen).toEqual([id]);
      expect(current).toBe(engine);
    });
  });

  it("entity:spawn on engine A does not reach engine B", async () => {
    const engineA = await createEngine({ maxEntities: 16 });
    const engineB = await createEngine({ maxEntities: 16 });
    const offs: Array<() => void> = [];
    try {
      const seenA: EntityId[] = [];
      const seenB: EntityId[] = [];
      offs.push(engineA.hooks.hook("entity:spawn", (id) => seenA.push(id)));
      offs.push(engineB.hooks.hook("entity:spawn", (id) => seenB.push(id)));
      const idB = engineB.createEntity();
      expect(seenB).toEqual([idB]);
      expect(seenA).toEqual([]);
      const idA = engineA.createEntity();
      expect(seenB).toEqual([idB]);
      expect(seenA).toEqual([idA]);
    } finally {
      for (const off of offs) off();
      await Promise.all([engineA.stop(), engineB.stop()]);
    }
  });

  it("entity:spawn fires once, after the deferred create is applied, for an entity created inside a chunk loop", async () => {
    await withEngine(32, (engine, offs) => {
      const anchor = engine.createEntity();
      engine.addComponent(anchor, Marker, { x: 0 });
      const seen: EntityId[] = [];
      let aliveInHandler: boolean | undefined;
      offs.push(
        engine.hooks.hook("entity:spawn", (id) => {
          seen.push(id);
          aliveInHandler = engine.isAlive(id);
        }),
      );
      const query = engine.run(() => useQuery([Marker]));
      let created: EntityId | undefined;
      let during = -1;
      for (const _chunk of query) {
        created = engine.createEntity();
        during = seen.length;
        break;
      }
      expect(during).toBe(0);
      expect(created).toBeDefined();
      if (created === undefined) return;
      expect(seen).toEqual([created]);
      expect(aliveInHandler).toBe(true);
      expect(engine.isAlive(created)).toBe(true);
    });
  });

  it("entity:spawn does not fire when createEntity throws CORE:ENTITY_LIMIT_REACHED", async () => {
    await withEngine(2, (engine, offs) => {
      const seen: EntityId[] = [];
      offs.push(engine.hooks.hook("entity:spawn", (id) => seen.push(id)));
      const first = engine.createEntity();
      const second = engine.createEntity();
      expect(seen).toEqual([first, second]);
      let thrown: unknown;
      try {
        engine.createEntity();
      } catch (error: unknown) {
        thrown = error;
      }
      expect(seen).toEqual([first, second]);
      expect(thrown).toBeInstanceOf(GwenWasmError);
      if (!(thrown instanceof GwenWasmError)) return;
      expect(thrown.code).toBe(CoreErrorCodes.ENTITY_LIMIT_REACHED);
    });
  });

  it("a throwing entity:spawn handler does not fail createEntity", async () => {
    await withEngine(16, async (engine, offs) => {
      const order: string[] = [];
      const reported: Array<{
        level: string;
        code: string;
        source?: string;
        context?: Record<string, unknown>;
      }> = [];
      offs.push(engine.errors.on((event) => reported.push(event)));
      offs.push(
        engine.hooks.hook("entity:spawn", () => {
          order.push("first");
          throw new Error("handler failed");
        }),
      );
      offs.push(
        engine.hooks.hook("entity:spawn", () => {
          order.push("second");
        }),
      );
      const id = engine.createEntity();
      expect(order).toEqual(["first", "second"]);
      expect(engine.isAlive(id)).toBe(true);
      expect(reported).toEqual([
        expect.objectContaining({
          level: "error",
          code: CoreErrorCodes.PLUGIN_RUNTIME_ERROR,
          source: "entity:spawn",
          context: { entityId: id },
        }),
      ]);

      offs.push(engine.hooks.hook("entity:spawn", () => Promise.reject(new Error("async fail"))));
      const later = engine.createEntity();
      await Promise.resolve();
      expect(engine.isAlive(later)).toBe(true);
      expect(reported).toEqual([
        expect.objectContaining({
          level: "error",
          code: CoreErrorCodes.PLUGIN_RUNTIME_ERROR,
          source: "entity:spawn",
          message: "handler failed",
          context: { entityId: id },
        }),
        expect.objectContaining({
          level: "error",
          code: CoreErrorCodes.PLUGIN_RUNTIME_ERROR,
          source: "entity:spawn",
          message: "handler failed",
          context: { entityId: later },
        }),
        expect.objectContaining({
          level: "error",
          code: CoreErrorCodes.PLUGIN_RUNTIME_ERROR,
          source: "entity:spawn",
          message: "async fail",
          context: { entityId: later },
        }),
      ]);
    });
  });

  it("actor:enable fires once with the entity id when a pooled actor is re-acquired (none on the first acquire)", async () => {
    await withEngine(32, async (engine, offs) => {
      const Actor = defineActor(plain, () => ({}));
      await engine.use(Actor._plugin);
      const pool = defineActorPool(Actor, { size: 2 });
      await engine.use(pool.plugin);
      const seen: bigint[] = [];
      offs.push(engine.hooks.hook("actor:enable", (id) => seen.push(id)));
      const id = pool.acquire();
      expect(seen).toEqual([]);
      pool.release(id);
      await engine.advance(0.016);
      const again = pool.acquire();
      expect(again).toBe(id);
      expect(seen).toEqual([id]);
    });
  });

  it("actor:disable fires once with the entity id when a pooled actor is released (silent for an id that is not active)", async () => {
    await withEngine(32, async (engine, offs) => {
      const Actor = defineActor(plain, () => ({}));
      await engine.use(Actor._plugin);
      const pool = defineActorPool(Actor, { size: 2 });
      await engine.use(pool.plugin);
      const seen: bigint[] = [];
      offs.push(engine.hooks.hook("actor:disable", (id) => seen.push(id)));
      const id = pool.acquire();
      pool.release(id);
      expect(seen).toEqual([]);
      await engine.advance(0.016);
      expect(seen).toEqual([id]);
      pool.release(id);
      const stranger = engine.createEntity();
      pool.release(stranger);
      await engine.advance(0.016);
      expect(seen).toEqual([id]);
    });
  });

  it("prefab:instantiate fires once with the entity id and the prefab extensions, after the components are written and before the actor factory runs", async () => {
    await withEngine(32, async (engine, offs) => {
      const order: string[] = [];
      let seenId: EntityId | undefined;
      let seenExt: Readonly<Record<string, unknown>> | undefined;
      let componentReady = false;
      const Actor = defineActor(labeled, () => {
        order.push("factory");
        return {};
      });
      await engine.use(Actor._plugin);
      offs.push(
        engine.hooks.hook("prefab:instantiate", (id, extensions) => {
          order.push("hook");
          seenId = id;
          seenExt = extensions;
          componentReady = engine.hasComponent(id, Marker);
        }),
      );
      const id = Actor._plugin.spawn();
      expect(order).toEqual(["hook", "factory"]);
      expect(seenId).toBe(id);
      expect(componentReady).toBe(true);
      expect(seenExt).toBe(labeled.extensions);
      expect(labeled.extensions).toEqual({ label: "box" });
    });
  });

  it("definePrefab stores extensions from its second argument", () => {
    expect(labeled.extensions).toEqual({ label: "box" });
  });

  it("prefab:instantiate fires with an empty extensions object for a prefab with none; also for usePrefab().spawn and placePrefab", async () => {
    await withEngine(32, async (engine, offs) => {
      const other = definePrefab([{ def: Marker, defaults: { x: 2 } }]);
      expect(plain.extensions).toBe(other.extensions);
      expect(plain.extensions).toEqual({});
      const seen: Array<Readonly<Record<string, unknown>>> = [];
      offs.push(
        engine.hooks.hook("prefab:instantiate", (_id, extensions) => {
          seen.push(extensions);
        }),
      );
      const Actor = defineActor(plain, () => ({}));
      await engine.use(Actor._plugin);
      const Layout = defineLayout(() => {
        const tile = placePrefab(plain);
        const actor = placeActor(Actor);
        const group = placeGroup();
        return { tile, actor, group };
      });
      await engine.run(async () => {
        const handle = usePrefab(plain);
        handle.spawn();
        const world = useLayout(Layout);
        await world.load();
      });
      expect(seen).toHaveLength(3);
      expect(seen[0]).toBe(plain.extensions);
      expect(seen[1]).toBe(plain.extensions);
      expect(seen[2]).toBe(plain.extensions);
    });
  });

  it("the four hooks reach listeners added with hookOnce, addHooks and a beforeEach/afterEach spy, and stop after removal", async () => {
    await withEngine(32, async (engine, offs) => {
      const once: EntityId[] = [];
      const onceOff = engine.hooks.hookOnce("entity:spawn", (id) => once.push(id));
      offs.push(onceOff);
      const first = engine.createEntity();
      const second = engine.createEntity();
      expect(once).toEqual([first]);
      expect(once).not.toContain(second);
      onceOff();

      const added: EntityId[] = [];
      const addOff = engine.hooks.addHooks({
        entity: {
          spawn: (id) => {
            added.push(id);
          },
        },
      });
      offs.push(addOff);
      const third = engine.createEntity();
      expect(added).toEqual([third]);
      addOff();
      engine.createEntity();
      expect(added).toEqual([third]);

      const hooked: EntityId[] = [];
      const listener = (id: EntityId): void => {
        hooked.push(id);
      };
      const hookOff = engine.hooks.hook("entity:spawn", listener);
      offs.push(hookOff);
      const fifth = engine.createEntity();
      expect(hooked).toEqual([fifth]);
      hookOff();
      engine.createEntity();
      expect(hooked).toEqual([fifth]);

      const removed: EntityId[] = [];
      const removeListener = (id: EntityId): void => {
        removed.push(id);
      };
      offs.push(engine.hooks.hook("entity:spawn", removeListener));
      engine.hooks.removeHook("entity:spawn", removeListener);
      engine.createEntity();
      expect(removed).toEqual([]);

      const kept: EntityId[] = [];
      const dropped: EntityId[] = [];
      const dropListener = (id: EntityId): void => {
        dropped.push(id);
      };
      const keepListener = (id: EntityId): void => {
        kept.push(id);
      };
      offs.push(engine.hooks.hook("entity:spawn", dropListener));
      offs.push(engine.hooks.hook("entity:spawn", keepListener));
      engine.hooks.removeHook("entity:spawn", dropListener);
      const paired = engine.createEntity();
      expect(dropped).toEqual([]);
      expect(kept).toEqual([paired]);

      const cleared: EntityId[] = [];
      offs.push(engine.hooks.hook("entity:spawn", (id) => cleared.push(id)));
      engine.hooks.clearHook("entity:spawn");
      engine.createEntity();
      expect(cleared).toEqual([]);

      const all: EntityId[] = [];
      offs.push(engine.hooks.hook("entity:spawn", (id) => all.push(id)));
      engine.hooks.removeAllHooks();
      engine.createEntity();
      expect(all).toEqual([]);

      const spyNames: string[] = [];
      const spyOff = engine.hooks.afterEach((event) => {
        spyNames.push(event.name);
      });
      offs.push(spyOff);
      engine.createEntity();
      expect(spyNames).toContain("entity:spawn");
      const beforeSpy = spyNames.length;
      spyOff();
      engine.createEntity();
      expect(spyNames).toHaveLength(beforeSpy);

      const beforeNames: string[] = [];
      const beforeOff = engine.hooks.beforeEach((event) => {
        beforeNames.push(event.name);
      });
      offs.push(beforeOff);
      engine.createEntity();
      expect(beforeNames).toContain("entity:spawn");
      beforeOff();

      const Actor = defineActor(plain, () => ({}));
      await engine.use(Actor._plugin);
      const pool = defineActorPool(Actor, { size: 4 });
      await engine.use(pool.plugin);

      const enableOnce: bigint[] = [];
      const enableOnceOff = engine.hooks.hookOnce("actor:enable", (id) => enableOnce.push(id));
      offs.push(enableOnceOff);
      const pooled = pool.acquire();
      pool.release(pooled);
      await engine.advance(0.016);
      pool.acquire();
      expect(enableOnce).toEqual([pooled]);
      pool.release(pooled);
      await engine.advance(0.016);
      pool.acquire();
      expect(enableOnce).toEqual([pooled]);
      enableOnceOff();

      const enableAdded: bigint[] = [];
      const enableAddOff = engine.hooks.addHooks({
        actor: {
          enable: (id) => {
            enableAdded.push(id);
          },
        },
      });
      offs.push(enableAddOff);
      pool.release(pooled);
      await engine.advance(0.016);
      pool.acquire();
      expect(enableAdded).toEqual([pooled]);
      enableAddOff();
      pool.release(pooled);
      await engine.advance(0.016);
      pool.acquire();
      expect(enableAdded).toEqual([pooled]);

      const enableSpy: string[] = [];
      const enableSpyOff = engine.hooks.afterEach((event) => {
        if (event.name === "actor:enable") enableSpy.push(event.name);
      });
      offs.push(enableSpyOff);
      pool.release(pooled);
      await engine.advance(0.016);
      pool.acquire();
      expect(enableSpy).toEqual(["actor:enable"]);
      enableSpyOff();
      pool.release(pooled);
      await engine.advance(0.016);
      pool.acquire();
      expect(enableSpy).toEqual(["actor:enable"]);

      const disableOnce: bigint[] = [];
      const disableOnceOff = engine.hooks.hookOnce("actor:disable", (id) => disableOnce.push(id));
      offs.push(disableOnceOff);
      pool.release(pooled);
      await engine.advance(0.016);
      expect(disableOnce).toEqual([pooled]);
      pool.acquire();
      pool.release(pooled);
      await engine.advance(0.016);
      expect(disableOnce).toEqual([pooled]);
      disableOnceOff();

      const disableAdded: bigint[] = [];
      const disableAddOff = engine.hooks.addHooks({
        actor: {
          disable: (id) => {
            disableAdded.push(id);
          },
        },
      });
      offs.push(disableAddOff);
      pool.acquire();
      pool.release(pooled);
      await engine.advance(0.016);
      expect(disableAdded).toEqual([pooled]);
      disableAddOff();

      const disableSpy: string[] = [];
      const disableSpyOff = engine.hooks.afterEach((event) => {
        if (event.name === "actor:disable") disableSpy.push(event.name);
      });
      offs.push(disableSpyOff);
      pool.acquire();
      pool.release(pooled);
      await engine.advance(0.016);
      expect(disableSpy).toEqual(["actor:disable"]);
      disableSpyOff();

      const prefabOnce: EntityId[] = [];
      const prefabOnceOff = engine.hooks.hookOnce("prefab:instantiate", (id) => {
        prefabOnce.push(id);
      });
      offs.push(prefabOnceOff);
      const spawned = Actor._plugin.spawn();
      Actor._plugin.spawn();
      expect(prefabOnce).toEqual([spawned]);
      prefabOnceOff();

      const prefabAdded: EntityId[] = [];
      const prefabAddOff = engine.hooks.addHooks({
        prefab: {
          instantiate: (id) => {
            prefabAdded.push(id);
          },
        },
      });
      offs.push(prefabAddOff);
      const addedSpawn = Actor._plugin.spawn();
      expect(prefabAdded).toEqual([addedSpawn]);
      prefabAddOff();
      Actor._plugin.spawn();
      expect(prefabAdded).toEqual([addedSpawn]);

      const prefabSpy: string[] = [];
      const prefabSpyOff = engine.hooks.afterEach((event) => {
        if (event.name === "prefab:instantiate") prefabSpy.push(event.name);
      });
      offs.push(prefabSpyOff);
      Actor._plugin.spawn();
      expect(prefabSpy).toEqual(["prefab:instantiate"]);
      prefabSpyOff();
      Actor._plugin.spawn();
      expect(prefabSpy).toEqual(["prefab:instantiate"]);
    });
  });

  it("entity:spawn fires once per entity of a bulk spawn", async () => {
    await withEngine(32, (engine, offs) => {
      const anchor = engine.createEntity();
      engine.addComponent(anchor, Marker, { x: 0 });
      const bridge = engine.tryInject("wasm:bridge");
      if (bridge === undefined) throw new Error("missing bridge");
      const seen: Array<{ id: EntityId; alive: boolean }> = [];
      offs.push(
        engine.hooks.hook("entity:spawn", (id) => {
          seen.push({ id, alive: engine.isAlive(id) });
        }),
      );
      const query = engine.run(() => useQuery([Marker]));
      let indices: Uint32Array<ArrayBufferLike> = new Uint32Array(0);
      let during = -1;
      for (const _chunk of query) {
        indices = bridge.bulkSpawnWithTransforms(
          new Float32Array([1, 2, 3, 4]),
          new Float32Array([0, 0]),
        );
        during = seen.length;
        break;
      }
      expect(during).toBe(0);
      expect(seen.map((event) => event.id)).toEqual(
        Array.from(indices, (index) => createEntityId(index, bridge.getEntityGeneration(index))),
      );
      expect(seen.map((event) => event.alive)).toEqual([true, true]);
    });
  });

  it("prefab instantiate inside a chunk loop sees the component after entity spawn", async () => {
    await withEngine(32, async (engine, offs) => {
      const anchor = engine.createEntity();
      engine.addComponent(anchor, Marker, { x: 0 });
      const Actor = defineActor(labeled, () => ({}));
      await engine.use(Actor._plugin);
      const order: string[] = [];
      let ready = false;
      let spawnedId: EntityId | undefined;
      offs.push(
        engine.hooks.hook("entity:spawn", (id) => {
          order.push("spawn");
          spawnedId = id;
        }),
      );
      offs.push(
        engine.hooks.hook("prefab:instantiate", (id) => {
          order.push("instantiate");
          ready = engine.hasComponent(id, Marker);
        }),
      );
      const query = engine.run(() => useQuery([Marker]));
      let created: EntityId | undefined;
      let during = -1;
      for (const _chunk of query) {
        created = Actor._plugin.spawn();
        during = order.length;
        break;
      }
      expect(during).toBe(0);
      expect(order).toEqual(["spawn", "instantiate"]);
      expect(ready).toBe(true);
      expect(spawnedId).toBe(created);
    });
  });

  it("entity spawn fires for a bulk spawn outside a chunk loop", async () => {
    await withEngine(32, (engine, offs) => {
      const bridge = engine.tryInject("wasm:bridge");
      if (bridge === undefined) throw new Error("missing bridge");
      const seen: EntityId[] = [];
      offs.push(
        engine.hooks.hook("entity:spawn", (id) => {
          seen.push(id);
        }),
      );
      const indices = bridge.bulkSpawnWithTransforms(
        new Float32Array([1, 2, 3, 4]),
        new Float32Array([0, 0]),
      );
      expect(seen).toEqual(
        Array.from(indices, (index) => createEntityId(index, bridge.getEntityGeneration(index))),
      );
    });
  });

  it("actor disable fires the old id when a destroyed pooled entity is replaced", async () => {
    await withEngine(32, async (engine, offs) => {
      const Actor = defineActor(plain, () => ({}));
      await engine.use(Actor._plugin);
      const pool = defineActorPool(Actor, { size: 2 });
      await engine.use(pool.plugin);
      const oldId = pool.acquire();
      engine.destroyEntity(oldId);
      const seen: bigint[] = [];
      offs.push(engine.hooks.hook("actor:disable", (id) => seen.push(id)));
      const next = pool.acquire();
      expect(entityIndex(next)).toBe(entityIndex(oldId));
      expect(seen).toEqual([oldId]);
    });
  });

  it("a deprecated hook name still fires entity spawn", async () => {
    await withEngine(16, (engine, offs) => {
      const previousWarn = console.warn;
      console.warn = () => {};
      try {
        const seen: bigint[] = [];
        engine.hooks.deprecateHook("actor:enable", "entity:spawn");
        const off = engine.hooks.hook("actor:enable", (id) => {
          seen.push(id);
        });
        offs.push(off);
        const id = engine.createEntity();
        expect(seen).toEqual([id]);
        off();
        const more: bigint[] = [];
        engine.hooks.deprecateHooks({ "actor:disable": { to: "entity:spawn" } });
        const offMore = engine.hooks.hook("actor:disable", (next) => {
          more.push(next);
        });
        offs.push(offMore);
        const second = engine.createEntity();
        expect(more).toEqual([second]);
      } finally {
        console.warn = previousWarn;
      }
    });
  });
});

import { describe, expect, it } from "vitest";
import { createEngine, createEngineLocal, useEngine, type GwenEngine } from "../../src/index.js";
import { engineContext } from "../../src/engine/context.js";
import { defineActor } from "../../src/actor/runtime/define-actor.js";
import { actorTablesFor } from "../../src/actor/runtime/define-actor.js";
import { useActor } from "../../src/actor/runtime/use-actor.js";
import { definePrefab } from "../../src/actor/runtime/define-prefab.js";
import { stubComponent } from "../helpers/stub-component.js";
import type { WasmEngine } from "../../src/engine/wasm-bridge-types.js";

const Position = stubComponent("Position");
const Prefab = definePrefab([{ def: Position, defaults: { x: 0, y: 0 } }]);

async function twoEngines(): Promise<[GwenEngine, GwenEngine]> {
  const a = await createEngine({ maxEntities: 16 });
  const b = await createEngine({ maxEntities: 16 });
  return [a, b];
}

describe("two engines", () => {
  it("registers the same component name without colliding", async () => {
    const [a, b] = await twoEngines();
    try {
      const idA = a.run(() => a.getOrRegisterComponent("Position"));
      const idB = b.run(() => b.getOrRegisterComponent("Position"));
      expect(a.registeredComponentTypes().has("Position")).toBe(true);
      expect(b.registeredComponentTypes().has("Position")).toBe(true);
      expect(a.registeredComponentTypes().get("Position")).toBe(idA);
      expect(b.registeredComponentTypes().get("Position")).toBe(idB);
      expect(idA).toBe(0);
      expect(idB).toBe(0);
    } finally {
      await a.stop();
      await b.stop();
    }
  });

  it("keeps the type count when the same name is registered again", async () => {
    const engine = await createEngine({ maxEntities: 16 });
    try {
      const bridge = engine.inject("wasm:bridge");
      let calls = 0;
      bridge._injectMock({
        register_component_type() {
          calls += 1;
          return calls;
        },
      } as WasmEngine);
      engine.run(() => {
        engine.getOrRegisterComponent("Position");
        engine.getOrRegisterComponent("Position");
        for (let i = 0; i < 200; i++) engine.getOrRegisterComponent("Position");
      });
      expect(engine.registeredComponentTypes().size).toBe(1);
      expect(calls).toBe(1);
    } finally {
      await engine.stop();
    }
  });

  it("counts and lists only the actors of the current engine", async () => {
    const [a, b] = await twoEngines();
    const Actor = defineActor(Prefab, () => ({ tag: "live" as const }));
    try {
      await a.use(Actor._plugin);
      await b.use(Actor._plugin);
      const handleA = a.run(() => useActor(Actor));
      const handleB = b.run(() => useActor(Actor));
      b.run(() => {
        handleB.spawn();
      });
      expect(a.run(() => handleA.count())).toBe(0);
      expect(a.run(() => handleA.getAll())).toEqual([]);
    } finally {
      await a.stop();
      await b.stop();
    }
  });

  it("does not despawn an actor that lives on the other engine", async () => {
    const [a, b] = await twoEngines();
    const Actor = defineActor(Prefab, () => ({ tag: "live" as const }));
    try {
      await a.use(Actor._plugin);
      await b.use(Actor._plugin);
      const handleA = a.run(() => useActor(Actor));
      const handleB = b.run(() => useActor(Actor));
      const idB = b.run(() => handleB.spawn());
      a.run(() => {
        handleA.despawn(idB);
      });
      expect(b.run(() => handleB.count())).toBe(1);
      expect(b.run(() => handleB.get()?.tag)).toBe("live");
    } finally {
      await a.stop();
      await b.stop();
    }
  });

  it("despawnAll on one engine leaves the other engine's actors", async () => {
    const [a, b] = await twoEngines();
    const Actor = defineActor(Prefab, () => ({ tag: "live" as const }));
    try {
      await a.use(Actor._plugin);
      await b.use(Actor._plugin);
      const handleA = a.run(() => useActor(Actor));
      const handleB = b.run(() => useActor(Actor));
      a.run(() => {
        handleA.spawn();
      });
      b.run(() => {
        handleB.spawn();
      });
      a.run(() => {
        handleA.despawnAll();
      });
      expect(a.run(() => handleA.count())).toBe(0);
      expect(b.run(() => handleB.count())).toBe(1);
    } finally {
      await a.stop();
      await b.stop();
    }
  });

  it("does not cross actor registries when two engines reuse a slot", async () => {
    const [a, b] = await twoEngines();
    const Actor = defineActor(Prefab, () => ({}));
    try {
      await a.use(Actor._plugin);
      await b.use(Actor._plugin);
      const idA = a.run(() => Actor._plugin.spawn());
      const idB = b.run(() => Actor._plugin.spawn());
      expect(idA).toBe(idB);
      expect(actorTablesFor(a).instances.get(idA)).not.toBe(actorTablesFor(b).instances.get(idB));
      expect(actorTablesFor(a).actors.has(idA)).toBe(true);
      expect(actorTablesFor(b).actors.has(idB)).toBe(true);
      a.run(() => {
        Actor._plugin.despawn(idA);
      });
      expect(actorTablesFor(a).instances.has(idA)).toBe(false);
      expect(actorTablesFor(b).instances.has(idB)).toBe(true);
    } finally {
      await a.stop();
      await b.stop();
    }
  });

  it("restores the outer engine after a nested run", async () => {
    const [a, b] = await twoEngines();
    try {
      a.run(() => {
        expect(useEngine()).toBe(a);
        b.run(() => {
          expect(useEngine()).toBe(b);
        });
        expect(useEngine()).toBe(a);
      });
      expect(engineContext.tryUse()).toBeFalsy();
    } finally {
      await a.stop();
      await b.stop();
    }
  });

  it("reads the same EngineLocal from the setup proxy and the engine", async () => {
    const engine = await createEngine({ maxEntities: 16 });
    const slot = createEngineLocal(() => ({ n: 1 }));
    let same = false;
    try {
      await engine.use({
        name: "p59-proxy",
        setup(proxy) {
          same = slot.get(proxy as GwenEngine) === slot.get(useEngine());
        },
      });
      expect(same).toBe(true);
    } finally {
      await engine.stop();
    }
  });

  it("restores the outer engine after callHookParallel", async () => {
    const [a, b] = await twoEngines();
    try {
      let syncEngine: GwenEngine | undefined;
      let asyncEngine: GwenEngine | undefined;
      b.hooks.hook("engine:tick", () => {
        syncEngine = engineContext.tryUse() ?? undefined;
      });
      b.hooks.hook("engine:afterTick", () => {
        asyncEngine = engineContext.tryUse() ?? undefined;
        return Promise.resolve();
      });
      a.activate();
      await b.hooks.callHookParallel("engine:tick", 0);
      expect(engineContext.tryUse()).toBe(a);
      await b.hooks.callHookParallel("engine:afterTick", 0);
      expect(engineContext.tryUse()).toBe(a);
      expect(syncEngine).toBe(b);
      expect(asyncEngine).toBe(b);
      a.deactivate();
    } finally {
      await a.stop();
      await b.stop();
    }
  });

  it("refuses spawn after the only installed engine has stopped", async () => {
    const Actor = defineActor(Prefab, () => ({}));
    const a = await createEngine({ maxEntities: 16 });
    await a.use(Actor._plugin);
    await a.stop();
    expect(() => Actor._plugin.spawn()).toThrow(/ACTOR:PLUGIN_NOT_READY/);
  });

  it("leaves the other engine's local intact after stop", async () => {
    const [a, b] = await twoEngines();
    const slot = createEngineLocal(() => ({ v: 0 }));
    a.run(() => {
      slot.use().v = 1;
    });
    b.run(() => {
      slot.use().v = 2;
    });
    await a.stop();
    b.run(() => {
      expect(slot.use().v).toBe(2);
    });
    expect(slot.peek(a)).toBeUndefined();
    await b.stop();
  });
});

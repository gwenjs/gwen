import { describe, it, expect, vi } from "vitest";
import { definePrefab } from "../../src/actor/runtime/define-prefab";
import { defineActor } from "../../src/actor/runtime/define-actor";
import { useActor, usePrefab } from "../../src/actor/runtime/use-actor";
import { createEngine } from "../../src/engine/gwen-engine";
import { GwenScope } from "../../src/context/scope";
import { SCENE_REGISTRAR_KEY } from "../../src/scene/runtime/scene-registrar";
import type { SceneRegistrar } from "../../src/scene/runtime/scene-registrar";
import type { GwenPlugin } from "../../src/engine/gwen-engine";

const Position = { __name__: "Position" };

const SimplePrefab = definePrefab([{ def: Position, defaults: { x: 0, y: 0 } }]);

describe("useActor", () => {
  it("spawn delegates to _plugin.spawn", async () => {
    const engine = await createEngine();
    const Actor = defineActor(SimplePrefab, () => ({ greet: () => "hi" }));
    await engine.use(Actor._plugin);

    const handle = engine.run(() => useActor(Actor));
    const id = handle.spawn();
    expect(Actor._instances.has(id)).toBe(true);
  });

  it("despawn delegates to _plugin.despawn", async () => {
    const engine = await createEngine();
    const Actor = defineActor(SimplePrefab, () => {});
    await engine.use(Actor._plugin);

    const handle = engine.run(() => useActor(Actor));
    const id = handle.spawn();
    handle.despawn(id);
    expect(Actor._instances.has(id)).toBe(false);
  });

  it("count returns number of live instances", async () => {
    const engine = await createEngine();
    const Actor = defineActor(SimplePrefab, () => {});
    await engine.use(Actor._plugin);

    const handle = engine.run(() => useActor(Actor));
    expect(handle.count()).toBe(0);
    handle.spawn();
    handle.spawn();
    expect(handle.count()).toBe(2);
  });

  it("get returns first live instance api", async () => {
    const engine = await createEngine();
    const Actor = defineActor(SimplePrefab, () => ({ value: 42 }));
    await engine.use(Actor._plugin);

    const handle = engine.run(() => useActor(Actor));
    expect(handle.get()).toBeUndefined();
    handle.spawn();
    expect(handle.get()?.value).toBe(42);
  });

  it("getAll returns all live instance apis", async () => {
    const engine = await createEngine();
    const Actor = defineActor(SimplePrefab, () => ({ value: 42 }));
    await engine.use(Actor._plugin);

    const handle = engine.run(() => useActor(Actor));
    handle.spawn();
    handle.spawn();
    expect(handle.getAll()).toHaveLength(2);
  });

  it("despawnAll removes all instances", async () => {
    const engine = await createEngine();
    const Actor = defineActor(SimplePrefab, () => {});
    await engine.use(Actor._plugin);

    const handle = engine.run(() => useActor(Actor));
    handle.spawn();
    handle.spawn();
    handle.despawnAll();
    expect(handle.count()).toBe(0);
  });

  it("spawnOnce spawns only one instance on repeated calls", async () => {
    const engine = await createEngine();
    const Actor = defineActor(SimplePrefab, () => {});
    await engine.use(Actor._plugin);

    const handle = engine.run(() => useActor(Actor));
    const id1 = handle.spawnOnce();
    const id2 = handle.spawnOnce();
    expect(id1).toBe(id2);
    expect(handle.count()).toBe(1);
  });
});

describe("usePrefab", () => {
  it("spawn creates an entity and adds prefab components", async () => {
    const engine = await createEngine();
    const Prefab = definePrefab([{ def: Position, defaults: { x: 0, y: 0 } }]);

    const { spawn, despawn } = engine.run(() => usePrefab(Prefab));
    const id = spawn();
    expect(engine.isAlive(id as never)).toBe(true);

    despawn(id);
    expect(engine.isAlive(id as never)).toBe(false);
  });

  it("spawn accepts component overrides", async () => {
    const engine = await createEngine();
    const Prefab = definePrefab([{ def: Position, defaults: { x: 0, y: 0 } }]);

    const { spawn } = engine.run(() => usePrefab(Prefab));
    const id = spawn({ x: 99 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pos = engine.getComponent(id as never, Position as any);
    expect(pos?.x).toBe(99);
  });
});

describe("ActorPlugin._deps — type contract", () => {
  it("_deps is an optional array on ActorPlugin", () => {
    const prefab = definePrefab([{ def: Position, defaults: { x: 0, y: 0 } }]);
    const Actor = defineActor(prefab, () => {});
    // _deps must not exist yet (no Vite transform in test env)
    expect((Actor._plugin as { _deps?: unknown })._deps).toBeUndefined();
    // assigning it must be structurally valid
    (Actor._plugin as { _deps?: unknown[] })._deps = [];
    expect((Actor._plugin as { _deps?: unknown[] })._deps).toHaveLength(0);
  });

  it("useActor registers _deps plugins into the scene context", async () => {
    const engine = await createEngine();
    const prefab = definePrefab([{ def: Position, defaults: { x: 0, y: 0 } }]);

    const ChildActor = defineActor(prefab, () => {});
    const ParentActor = defineActor(prefab, () => {});

    // Simulate what the Vite transform injects at build time
    (ParentActor._plugin as { _deps?: unknown[] })._deps = [ChildActor._plugin];

    const systems: GwenPlugin[] = [];
    const registrar: SceneRegistrar = {
      register: (p) => {
        if (!systems.includes(p)) systems.push(p);
      },
    };

    engine.run(() => {
      engine.provide(SCENE_REGISTRAR_KEY, registrar);
      useActor(ParentActor);
    });

    // Both ParentActor and ChildActor plugins must be in the scene context
    expect(systems).toContain(ParentActor._plugin);
    expect(systems).toContain(ChildActor._plugin);
  });
});

describe("useActor — Proxy PublicAPI delegation", () => {
  it("throws GwenActorError when a PublicAPI method is called with no live instance", async () => {
    const engine = await createEngine();
    const Actor = defineActor(SimplePrefab, () => ({ shoot: () => "pew" }));
    await engine.use(Actor._plugin);

    const handle = engine.run(() => useActor(Actor)) as ReturnType<
      typeof useActor<void, { shoot(): string }>
    >;

    // No instance has been spawned yet — must throw, not silently return undefined
    expect(() => (handle as unknown as { shoot(): string }).shoot()).toThrow("[GWEN]");
  });

  it("delegates to the first live instance PublicAPI after spawn", async () => {
    const engine = await createEngine();
    const Actor = defineActor(SimplePrefab, () => ({ shoot: () => "pew" }));
    await engine.use(Actor._plugin);

    const handle = engine.run(() => useActor(Actor)) as ReturnType<
      typeof useActor<void, { shoot(): string }>
    >;
    handle.spawn();

    expect((handle as unknown as { shoot(): string }).shoot()).toBe("pew");
  });
});

describe("ActorHandle[Symbol.iterator]", () => {
  it("yields nothing when no instances exist", async () => {
    const engine = await createEngine();
    const Actor = defineActor(SimplePrefab, () => ({ value: 1 }));
    await engine.use(Actor._plugin);

    const handle = engine.run(() => useActor(Actor));
    expect(Array.from(handle as Iterable<{ value: number }>)).toHaveLength(0);
  });

  it("yields all live instance APIs", async () => {
    const engine = await createEngine();
    const Actor = defineActor(SimplePrefab, () => ({ value: 42 }));
    await engine.use(Actor._plugin);

    const handle = engine.run(() => useActor(Actor));
    handle.spawn();
    handle.spawn();

    const apis = Array.from(handle as Iterable<{ value: number }>);
    expect(apis).toHaveLength(2);
    expect(apis[0].value).toBe(42);
  });

  it("reflects despawn — despawned instance is no longer yielded", async () => {
    const engine = await createEngine();
    const Actor = defineActor(SimplePrefab, () => ({}));
    await engine.use(Actor._plugin);

    const handle = engine.run(() => useActor(Actor));
    const id = handle.spawn();
    handle.spawn();
    expect(Array.from(handle as Iterable<unknown>)).toHaveLength(2);

    handle.despawn(id);
    expect(Array.from(handle as Iterable<unknown>)).toHaveLength(1);
  });

  it("works via for...of", async () => {
    const engine = await createEngine();
    const Actor = defineActor(SimplePrefab, () => ({ mark: () => "x" }));
    await engine.use(Actor._plugin);

    const handle = engine.run(() => useActor(Actor));
    handle.spawn();

    const collected: string[] = [];
    for (const api of handle as Iterable<{ mark(): string }>) {
      collected.push(api.mark());
    }
    expect(collected).toEqual(["x"]);
  });
});

describe("useActor — auto-cleanup on scene exit", () => {
  it("despawns live instances when scene:beforeLeave fires", async () => {
    const engine = await createEngine();
    const Actor = defineActor(SimplePrefab, () => {});
    await engine.use(Actor._plugin);

    const scope = new GwenScope(engine, { type: "scene" });
    const handle = scope.run(() => engine.run(() => useActor(Actor)));

    handle.spawn();
    handle.spawn();
    expect(handle.count()).toBe(2);

    await engine.hooks.callHook("scene:beforeLeave", "any");

    expect(handle.count()).toBe(0);
    scope.dispose();
  });

  it("does not fire warning when 0 instances remain at exit", async () => {
    const engine = await createEngine({ debug: true });
    const Actor = defineActor(SimplePrefab, () => {});
    await engine.use(Actor._plugin);

    const warnSpy = vi.spyOn(engine.logger, "warn");
    const scope = new GwenScope(engine, { type: "scene" });
    const handle = scope.run(() => engine.run(() => useActor(Actor)));

    const id = handle.spawn();
    handle.despawn(id);

    await engine.hooks.callHook("scene:beforeLeave", "any");

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
    scope.dispose();
  });

  it("logs a dev warning (debug: true) when auto-cleanup runs", async () => {
    const engine = await createEngine({ debug: true });
    const Actor = defineActor(SimplePrefab, () => {});
    await engine.use(Actor._plugin);

    const warnSpy = vi.spyOn(engine.logger, "warn");
    const scope = new GwenScope(engine, { type: "scene" });
    const handle = scope.run(() => engine.run(() => useActor(Actor)));

    handle.spawn();

    await engine.hooks.callHook("scene:beforeLeave", "any");

    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0]![0]).toMatch(/auto-cleanup/);
    warnSpy.mockRestore();
    scope.dispose();
  });

  it("does not log a warning when debug is false", async () => {
    const engine = await createEngine({ debug: false });
    const Actor = defineActor(SimplePrefab, () => {});
    await engine.use(Actor._plugin);

    const warnSpy = vi.spyOn(engine.logger, "warn");
    const scope = new GwenScope(engine, { type: "scene" });
    const handle = scope.run(() => engine.run(() => useActor(Actor)));

    handle.spawn();

    await engine.hooks.callHook("scene:beforeLeave", "any");

    expect(warnSpy).not.toHaveBeenCalled();
    expect(handle.count()).toBe(0); // cleaned up silently
    warnSpy.mockRestore();
    scope.dispose();
  });

  it("does not register cleanup when called outside a scene scope", async () => {
    const engine = await createEngine({ debug: true });
    const Actor = defineActor(SimplePrefab, () => {});
    await engine.use(Actor._plugin);

    // No active scope — no auto-cleanup hook registered
    const handle = engine.run(() => useActor(Actor));
    handle.spawn();

    await engine.hooks.callHook("scene:beforeLeave", "any");

    expect(handle.count()).toBe(1);
    handle.despawnAll();
  });
});

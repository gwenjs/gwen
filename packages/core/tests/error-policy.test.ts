import { afterEach, describe, expect, it, vi } from "vitest";
import type { GwenErrorPayload } from "@gwenjs/schema";
import { defineActor, definePrefab } from "../src/actor/index";
import { defineActorPool } from "../src/actor/runtime/pool/define-actor-pool";
import { createDisposable } from "../src/disposable";
import { CoreErrorCodes, createEngine, useHook, type EngineErrorPayload } from "../src/index";
import { defineScene, useSystem, type SystemHandle } from "../src/scene/index";
import { defineSystem, onUpdate } from "../src/system/index";

afterEach(() => {
  vi.unstubAllGlobals();
});

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

describe("error policy table", () => {
  it("logs each level, fires engine:error only for error and fatal, and isolates a target", async () => {
    const engine = await createEngine({ debug: true });
    const logs: Array<{ level: string; message: string }> = [];
    engine.logger.setSink((entry) => {
      logs.push({ level: entry.level, message: entry.message });
    });
    const hookLevels: string[] = [];
    const order: string[] = [];
    engine.errors.on(() => {
      order.push("on");
    });
    engine.hooks.hook("engine:error", (payload) => {
      order.push("hook");
      hookLevels.push(payload.level);
    });

    engine.errors.emit({ level: "verbose", code: "TEST:VERBOSE", message: "verbose" });
    engine.errors.emit({ level: "info", code: "TEST:INFO", message: "info" });
    engine.errors.emit({ level: "warning", code: "TEST:WARNING", message: "warning" });

    expect(logs.map((entry) => entry.level)).toEqual(["debug", "info", "warn"]);
    expect(hookLevels).toEqual([]);
    expect(engine.state).toBe("idle");
    expect(engine.isolated()).toEqual([]);

    engine.errors.emit({
      level: "error",
      code: "TEST:ERROR",
      message: "error",
      target: { kind: "system", id: "system#policy", name: "Policy" },
    });

    expect(logs.at(-2)?.level).toBe("error");
    expect(logs.at(-1)?.message).toContain('reenable("system#policy")');
    expect(hookLevels).toEqual(["error"]);
    expect(order.slice(-2)).toEqual(["on", "hook"]);
    expect(engine.isolated().map((target) => target.id)).toEqual(["system#policy"]);
    expect(engine.state).toBe("idle");

    let stopped = false;
    engine.hooks.hook("engine:stop", () => {
      stopped = true;
    });
    engine.errors.emit({ level: "fatal", code: "TEST:FATAL", message: "fatal" });

    expect(logs.at(-1)?.level).toBe("error");
    expect(hookLevels).toEqual(["error", "fatal"]);
    expect(engine.state).toBe("idle");
    expect(stopped).toBe(false);
  });

  it("faults a running engine on fatal without stop() or disposeAll()", async () => {
    const engine = await createEngine();
    let stopped = false;
    let disposed = false;
    const hooks: EngineErrorPayload[] = [];
    engine.hooks.hook("engine:stop", () => {
      stopped = true;
    });
    engine.hooks.hook("engine:error", (payload) => {
      hooks.push(payload);
    });
    engine.disposables.add(
      "probe",
      createDisposable(() => {
        disposed = true;
      }),
    );
    await engine.startExternal();

    engine.errors.emit({ level: "fatal", code: "TEST:FATAL", message: "fatal" });

    expect(engine.state).toBe("faulted");
    expect(hooks).toHaveLength(1);
    expect(hooks[0]?.level).toBe("fatal");
    expect(stopped).toBe(false);
    expect(disposed).toBe(false);
    await expect(engine.advance(0.016)).rejects.toThrow(/faulted/);
    await expect(engine.start()).rejects.toThrow(/faulted/);
  });
});

describe("frame isolation", () => {
  it("isolates a throwing system, keeps the sibling and the frame, then re-isolates after reenable", async () => {
    const engine = await createEngine({ debug: true });
    const warns: string[] = [];
    engine.logger.setSink((entry) => {
      if (entry.level === "warn") warns.push(entry.message);
    });
    const runtime: GwenErrorPayload[] = [];
    const pluginErrors: string[] = [];
    let sibling = 0;
    let afterTick = 0;
    engine.errors.on((event) => {
      if (event.code === CoreErrorCodes.PLUGIN_RUNTIME_ERROR) runtime.push(event);
    });
    engine.hooks.hook("plugin:error", (payload) => {
      pluginErrors.push(payload.pluginName);
    });
    engine.hooks.hook("engine:afterTick", () => {
      afterTick += 1;
    });

    await engine.use(
      defineSystem("Sibling", () => {
        onUpdate(() => {
          sibling += 1;
        });
      })(),
    );
    await engine.use(
      defineSystem("BadSys", () => {
        onUpdate(() => {
          throw new Error("bad system");
        });
      })(),
    );

    await engine.advance(0.016);
    await engine.advance(0.016);

    expect(sibling).toBe(2);
    expect(afterTick).toBe(2);
    expect(engine.frameCount).toBe(2);
    expect(runtime).toHaveLength(1);
    expect(runtime[0]?.level).toBe("error");
    expect(runtime[0]?.target?.kind).toBe("system");
    expect(runtime[0]?.target?.name).toBe("BadSys");
    expect(pluginErrors).toEqual(["BadSys"]);
    const isolated = engine.isolated();
    expect(isolated.map((target) => target.kind)).toEqual(["system"]);
    const id = isolated[0]!.id;
    const isolationWarns = warns.filter((message) => message.includes("isolated after"));
    expect(isolationWarns).toHaveLength(1);
    expect(isolationWarns[0]).toContain("CORE:PLUGIN_RUNTIME_ERROR");
    expect(isolationWarns[0]).toContain(`reenable("${id}")`);

    expect(engine.reenable("missing")).toBe(false);
    expect(engine.reenable(id)).toBe(true);
    expect(engine.isolated()).toEqual([]);

    await engine.advance(0.016);

    expect(sibling).toBe(3);
    expect(engine.frameCount).toBe(3);
    expect(runtime).toHaveLength(2);
    expect(engine.isolated().map((target) => target.id)).toEqual([id]);
    expect(warns.filter((message) => message.includes("isolated after"))).toHaveLength(2);
  });

  it("does not clear system isolation on SystemHandle.resume()", async () => {
    const engine = await createEngine();
    let hits = 0;
    let handle!: SystemHandle;
    const Sys = defineSystem("ResumeIso", () => {
      onUpdate(() => {
        hits += 1;
        throw new Error("iso");
      });
    });
    const Scene = defineScene("ResumeIsoScene", () => {
      handle = useSystem(Sys());
    });
    const def = engine.run(() => Scene({ register: () => {} }));
    await engine.use(def.systems[0]!);

    await engine.advance(0.016);

    expect(handle.isolated).toBe(true);
    expect(handle.active).toBe(false);
    handle.resume();
    expect(handle.isolated).toBe(true);
    expect(handle.active).toBe(false);

    await engine.advance(0.016);

    expect(hits).toBe(1);
    expect(handle.isolated).toBe(true);
  });

  it("isolates an actor and leaves that isolation in place when the pool acquires another", async () => {
    const engine = await createEngine();
    const Hp = { __name__: "Hp" };
    const Prefab = definePrefab([{ def: Hp, defaults: { value: 1 } }]);
    let throws = 0;
    const Actor = defineActor("BoomActor", Prefab, () => {
      onUpdate(() => {
        throws += 1;
        throw new Error("actor boom");
      });
    });
    await engine.use(Actor._plugin);
    const pool = defineActorPool(Actor, { size: 2 });
    await engine.use(pool._plugin);

    const firstId = pool.acquire();
    await engine.advance(0.016);
    const first = engine.isolated().find((target) => target.kind === "actor");
    expect(first?.entityId).toBe(firstId);

    const secondId = pool.acquire();
    expect(secondId).not.toBe(firstId);
    expect(engine.isolated().some((target) => target.id === first?.id)).toBe(true);

    await engine.advance(0.016);

    expect(throws).toBe(2);
    expect(engine.isolated().some((target) => target.id === first?.id)).toBe(true);
    expect(engine.isolated().filter((target) => target.kind === "actor")).toHaveLength(2);
  });

  it("attributes a useHook handler registered during setup to the plugin", async () => {
    const engine = await createEngine();
    const runtime: GwenErrorPayload[] = [];
    engine.errors.on((event) => {
      if (event.code === CoreErrorCodes.PLUGIN_RUNTIME_ERROR) runtime.push(event);
    });
    await engine.use({
      name: "attributed",
      setup() {
        useHook("engine:update", () => {
          throw new Error("from hook");
        });
      },
    });

    await engine.advance(0.016);

    expect(runtime).toHaveLength(1);
    expect(runtime[0]?.target).toMatchObject({
      kind: "plugin",
      id: "attributed",
      name: "attributed",
    });
    expect(engine.isolated().map((target) => target.id)).toEqual(["attributed"]);
  });

  it("does not isolate or emit when onError calls recover()", async () => {
    const engine = await createEngine();
    const runtime: string[] = [];
    let pluginErrors = 0;
    let calls = 0;
    engine.errors.on((event) => {
      if (event.code === CoreErrorCodes.PLUGIN_RUNTIME_ERROR) runtime.push(event.code);
    });
    engine.hooks.hook("plugin:error", () => {
      pluginErrors += 1;
    });
    await engine.use({
      name: "soft",
      setup(scoped) {
        scoped.hooks.hook("engine:update", () => {
          calls += 1;
          throw new Error("soft");
        });
      },
      onError(_error, ctx) {
        ctx.recover();
      },
    });

    await engine.advance(0.016);

    expect(calls).toBe(1);
    expect(runtime).toEqual([]);
    expect(pluginErrors).toBe(0);
    expect(engine.isolated()).toEqual([]);
  });

  it("reports an unidentified handler as CORE:FRAME_LOOP_ERROR and finishes the frame", async () => {
    const engine = await createEngine();
    const runtime: GwenErrorPayload[] = [];
    let afterUpdate = 0;
    let afterTick = 0;
    engine.errors.on((event) => {
      if (event.message === "raw") runtime.push(event);
    });
    engine.hooks.hook("engine:update", () => {
      throw new Error("raw");
    });
    engine.hooks.hook("engine:after-update", () => {
      afterUpdate += 1;
    });
    engine.hooks.hook("engine:afterTick", () => {
      afterTick += 1;
    });

    await engine.advance(0.016);

    expect(runtime.map((event) => event.code)).toEqual([CoreErrorCodes.FRAME_LOOP_ERROR]);
    expect(runtime[0]?.level).toBe("error");
    expect(runtime[0]?.target).toBeUndefined();
    expect(afterUpdate).toBe(1);
    expect(afterTick).toBe(1);
    expect(engine.frameCount).toBe(1);
    expect(engine.isolated()).toEqual([]);
    expect(engine.state).toBe("idle");
  });
});

describe("plugin lifecycle errors", () => {
  it("rejects use() with level error and still runs a sibling hook", async () => {
    const engine = await createEngine();
    let sibling = 0;
    await engine.use({
      name: "sibling",
      setup(scoped) {
        scoped.hooks.hook("engine:update", () => {
          sibling += 1;
        });
      },
    });
    const setupEvents: GwenErrorPayload[] = [];
    engine.errors.on((event) => {
      if (event.code === CoreErrorCodes.PLUGIN_SETUP_ERROR) setupEvents.push(event);
    });

    await expect(
      engine.use({
        name: "bad-setup",
        setup() {
          throw new Error("setup boom");
        },
      }),
    ).rejects.toThrow("setup boom");

    expect(setupEvents.map((event) => event.level)).toEqual(["error"]);
    expect(setupEvents[0]?.target).toMatchObject({ kind: "plugin", id: "bad-setup" });
    expect(engine.state).toBe("idle");
    expect(engine.isolated().some((target) => target.id === "bad-setup")).toBe(false);
    await engine.advance(0.016);
    expect(sibling).toBe(1);
  });

  it("suppresses the setup event when onError calls recover(), and use() still rejects", async () => {
    const engine = await createEngine();
    const codes: string[] = [];
    engine.errors.on((event) => {
      codes.push(event.code);
    });

    await expect(
      engine.use({
        name: "soft-setup",
        setup() {
          throw new Error("handled setup");
        },
        onError(_error, ctx) {
          ctx.recover();
        },
      }),
    ).rejects.toThrow("handled setup");

    expect(codes).toEqual([]);
    expect(engine.isolated()).toEqual([]);
    expect(engine.state).toBe("idle");
  });

  it("removes a plugin when teardown throws", async () => {
    const engine = await createEngine();
    let ran = 0;
    await engine.use({
      name: "temp",
      setup(scoped) {
        scoped.hooks.hook("engine:update", () => {
          ran += 1;
        });
      },
      teardown() {
        throw new Error("teardown boom");
      },
    });
    const phases: unknown[] = [];
    engine.errors.on((event) => {
      if (event.code === CoreErrorCodes.PLUGIN_RUNTIME_ERROR) phases.push(event.context?.phase);
    });

    await engine.unuse("temp");

    expect(phases).toEqual(["teardown"]);
    expect(engine.isolated().some((target) => target.id === "temp")).toBe(false);
    await engine.advance(0.016);
    expect(ran).toBe(0);
    await engine.use({ name: "temp", setup() {} });
  });

  it("still runs disposeAll when an engine:stop handler throws", async () => {
    const engine = await createEngine();
    let disposed = false;
    engine.disposables.add(
      "probe",
      createDisposable(() => {
        disposed = true;
      }),
    );
    engine.hooks.hook("engine:stop", () => {
      throw new Error("stop boom");
    });

    await engine.stop();

    expect(disposed).toBe(true);
    expect(engine.state).toBe("stopped");
  });

  it("uninstalls window handlers on stop()", async () => {
    const listeners = new Map<string, Set<EventListener>>();
    const fake = {
      onerror: null as Window["onerror"],
      addEventListener(type: string, listener: EventListener): void {
        const set = listeners.get(type) ?? new Set<EventListener>();
        set.add(listener);
        listeners.set(type, set);
      },
      removeEventListener(type: string, listener: EventListener): void {
        listeners.get(type)?.delete(listener);
      },
    };
    vi.stubGlobal("window", fake);
    const engine = await createEngine();
    expect(typeof fake.onerror).toBe("function");
    expect(listeners.get("unhandledrejection")?.size).toBe(1);

    await engine.stop();

    expect(fake.onerror).toBeNull();
    expect(listeners.get("unhandledrejection")?.size ?? 0).toBe(0);
  });

  it("keeps the fixed-step loop scheduling when errors.on throws", async () => {
    const engine = await createEngine({ physicsHz: 60 });
    engine.errors.on(() => {
      throw new Error("listener");
    });
    await engine.use(
      defineSystem("LoopBoom", () => {
        onUpdate(() => {
          throw new Error("frame");
        });
      })(),
    );

    try {
      await engine.start();
      await wait(100);
      expect(engine.frameCount).toBeGreaterThanOrEqual(3);
      expect(engine.state).toBe("running");
    } finally {
      await engine.stop();
    }
  });
});

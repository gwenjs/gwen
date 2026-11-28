import { afterEach, describe, expect, it } from "vitest";
import { defineActor } from "../../src/actor/runtime/define-actor";
import { definePrefab } from "../../src/actor/runtime/define-prefab";
import { useActor } from "../../src/actor/runtime/use-actor";
import type { GwenEngine } from "../../src/engine/engine-types.js";
import { hotReplaceScene, registerSceneHandles, type GwenHotReport } from "../../src/internal.js";
import { createEngine } from "../../src/node.js";
import { SceneEnginePlugin } from "../../src/scene/engine-plugin";
import { defineScene, type SceneDefinition } from "../../src/scene/runtime/define-scene";
import { onEnter, onExit, onPreload, useSystem } from "../../src/scene/runtime/scene-context";
import type { SystemHandle } from "../../src/scene/runtime/system-handle";
import { defineComponent, Types } from "../../src/schema";
import { defineSystem, onUpdate } from "../../src/system/runtime/define-system";
import { fakePreload } from "./fake-preload-plugin";

const REGISTRY = { register: () => {} };
const engines: GwenEngine[] = [];

async function boot(): Promise<GwenEngine> {
  const engine = await createEngine();
  engines.push(engine);
  await engine.use(SceneEnginePlugin());
  return engine;
}

afterEach(async () => {
  for (const engine of engines.splice(0)) await engine.stop();
});

/** What the generated entry does for one scene: build it, record its handles, install its plugins. */
async function install(
  engine: GwenEngine,
  scene: (registry: typeof REGISTRY) => SceneDefinition,
): Promise<SceneDefinition> {
  const def = engine.run(() => scene(REGISTRY));
  registerSceneHandles(engine, def.name, def.handles);
  for (const plugin of def.systems) await engine.use(plugin);
  return def;
}

/** One system whose update body pushes `tag` into `log`. */
function ticker(name: string, tag: string, log: string[]) {
  return defineSystem(name, () => {
    onUpdate(() => {
      log.push(tag);
    });
  });
}

describe.runIf(__GWEN_DEV__)("hotReplaceScene", () => {
  it("the active scene is not re-entered and its entities survive", async () => {
    const engine = await boot();
    let enters = 0;
    const Menu = defineScene("Menu", () => {
      onEnter(() => {
        enters++;
        engine.createEntity();
      });
    });
    const Menu2 = defineScene("Menu", () => {
      onEnter(() => {
        enters += 10;
      });
    });
    await install(engine, Menu);
    await engine.hooks.callHook("scene:enter", "Menu");

    const report = await hotReplaceScene(Menu, Menu2);

    expect(report).toEqual({ status: "applied", kind: "scene", name: "Menu", count: 1 });
    expect(enters).toBe(1);
    expect(engine.getStats().entityCount).toBe(1);
  });

  it("future transitions use the new onEnter", async () => {
    const engine = await boot();
    const log: string[] = [];
    const Menu = defineScene("Menu", () => {
      onEnter(() => {
        log.push("old enter");
      });
      onExit(() => {
        log.push("old exit");
      });
    });
    const Menu2 = defineScene("Menu", () => {
      onEnter(() => {
        log.push("new enter");
      });
      onExit(() => {
        log.push("new exit");
      });
    });
    await install(engine, Menu);
    await engine.hooks.callHook("scene:enter", "Menu");
    log.length = 0;

    const report = await hotReplaceScene(Menu, Menu2);
    expect(report).toMatchObject({ status: "applied", count: 1 });
    await engine.hooks.callHook("scene:beforeLeave", "Menu");
    await engine.hooks.callHook("scene:enter", "Menu");

    expect(log).toEqual(["new exit", "new enter"]);
  });

  it("a system with the same name and a new factory is swapped in place", async () => {
    const engine = await boot();
    const log: string[] = [];
    const Game = defineScene("Game", () => {
      useSystem(ticker("Tick", "old", log)());
    });
    const Game2 = defineScene("Game", () => {
      useSystem(ticker("Tick", "new", log)());
    });
    await install(engine, Game);
    await engine.hooks.callHook("scene:enter", "Game");
    await engine.advance(0.016);

    const report = await hotReplaceScene(Game, Game2);
    expect(report).toEqual({ status: "applied", kind: "scene", name: "Game", count: 1 });
    await engine.advance(0.016);

    expect(log).toEqual(["old", "new"]);
  });

  it("a system with the same factory is left untouched and keeps its handle and pause flags", async () => {
    const engine = await boot();
    const log: string[] = [];
    const Tick = ticker("Tick", "tick", log);
    const Game = defineScene("Game", () => {
      useSystem(Tick());
    });
    const Game2 = defineScene("Game", () => {
      useSystem(Tick());
    });
    const def = await install(engine, Game);
    const handle = def.handles[0];
    expect(handle).toBeDefined();
    if (handle === undefined) return;
    handle.pause();
    const plugins = engine.getStats().plugins;

    const report = await hotReplaceScene(Game, Game2);

    expect(report).toEqual({ status: "applied", kind: "scene", name: "Game", count: 1 });
    await engine.hooks.callHook("scene:enter", "Game");
    expect(handle.active).toBe(false);
    expect(engine.getStats().plugins).toBe(plugins);
    expect(log).toEqual([]);
  });

  it("a removed system is unused and an added one is installed paused when the scene is inactive", async () => {
    const engine = await boot();
    const log: string[] = [];
    const Keep = ticker("Keep", "keep", log);
    const Gone = ticker("Gone", "gone", log);
    const Added = ticker("Added", "added", log);
    const Level = defineScene("Level", () => {
      useSystem(Keep());
      useSystem(Gone());
    });
    const Level2 = defineScene("Level", () => {
      useSystem(Keep());
      useSystem(Added());
    });
    const def = await install(engine, Level);
    for (const handle of def.handles) handle._scenePause();
    const before = engine.getStats().plugins;

    const report = await hotReplaceScene(Level, Level2);
    expect(report).toEqual({ status: "applied", kind: "scene", name: "Level", count: 1 });
    await engine.advance(0.016);

    expect(engine.getStats().plugins).toBe(before);
    expect(log).toEqual([]);
    await engine.hooks.callHook("scene:enter", "Level");
    await engine.advance(0.016);
    expect(log).toEqual(["keep", "added"]);
  });

  it("an added system is installed running when the scene is active", async () => {
    const engine = await boot();
    const log: string[] = [];
    const Added = ticker("Added", "added", log);
    const Game = defineScene("Game", () => {});
    const Game2 = defineScene("Game", () => {
      useSystem(Added());
    });
    await install(engine, Game);
    await engine.hooks.callHook("scene:enter", "Game");

    const report = await hotReplaceScene(Game, Game2);
    expect(report).toEqual({ status: "applied", kind: "scene", name: "Game", count: 1 });
    await engine.advance(0.016);

    expect(log).toEqual(["added"]);
  });

  it("a renamed scene reports scene-set-changed", async () => {
    const engine = await boot();
    const log: string[] = [];
    const Menu = defineScene("Menu", () => {
      onEnter(() => {
        log.push("old enter");
      });
    });
    const Title = defineScene("Title", () => {
      onEnter(() => {
        log.push("new enter");
      });
    });
    await install(engine, Menu);

    const report = await hotReplaceScene(Menu, Title);
    expect(report).toMatchObject({
      status: "reload",
      kind: "scene",
      name: "Menu",
      reason: "scene-set-changed",
    });
    await engine.hooks.callHook("scene:enter", "Menu");

    expect(log).toEqual(["old enter"]);
  });

  it("an inline actor with an installed name is swapped", async () => {
    const engine = await boot();
    const Hp = defineComponent({ name: "SceneHp", schema: { hp: Types.f32 } });
    const HpPrefab = definePrefab([{ def: Hp, defaults: { hp: 10 } }]);
    const make = (tag: string) => {
      const Unit = defineActor("SceneUnit", HpPrefab, () => ({ tag }));
      const Arena = defineScene("Arena", () => {
        useActor(Unit);
      });
      return { Unit, Arena };
    };
    const first = make("old");
    const second = make("new");
    await install(engine, first.Arena);
    const id = first.Unit._plugin.spawn();

    const report = await hotReplaceScene(first.Arena, second.Arena);

    expect(report).toEqual({ status: "applied", kind: "scene", name: "Arena", count: 1 });
    expect(first.Unit._instances.get(id)?.api).toEqual({ tag: "new" });
  });

  it("a preload callback added to the active scene by a swap runs only at the next transition", async () => {
    const engine = await boot();
    const preload = fakePreload();
    const Game = defineScene("Game", () => {});
    const Game2 = defineScene("Game", () => {
      onPreload(() => {
        preload.ready.add("level-2");
      });
    });
    await install(engine, Game);
    await engine.hooks.callHook("scene:enter", "Game");

    const report = await hotReplaceScene(Game, Game2);
    expect(report).toEqual({ status: "applied", kind: "scene", name: "Game", count: 1 });
    const readyAfterSwap = [...preload.ready];
    await engine.hooks.callHook("scene:preload", { from: null, to: "Game", progress: () => {} });

    expect(readyAfterSwap).toEqual([]);
    expect([...preload.ready]).toEqual(["level-2"]);
  });

  it("the old scene scope is disposed: its useActor despawn hook is gone and the new one runs", async () => {
    const engine = await boot();
    const Hp = defineComponent({ name: "ScopeHp", schema: { hp: Types.f32 } });
    const HpPrefab = definePrefab([{ def: Hp, defaults: { hp: 1 } }]);
    const make = (tag: string) => {
      const Unit = defineActor("ScopeUnit", HpPrefab, () => ({ tag }));
      const Arena = defineScene("Arena", () => {
        useActor(Unit);
      });
      return { Unit, Arena };
    };
    const first = make("old");
    const second = make("new");
    await install(engine, first.Arena);
    const id = first.Unit._plugin.spawn();

    const report = await hotReplaceScene(first.Arena, second.Arena);

    expect(report).toEqual({ status: "applied", kind: "scene", name: "Arena", count: 1 });
    const nextId = second.Unit._plugin.spawn();
    await engine.hooks.callHook("scene:beforeLeave", "Arena");
    expect(first.Unit._instances.has(id)).toBe(true);
    expect(second.Unit._instances.has(nextId)).toBe(false);
  });

  it("two engines are both swapped", async () => {
    const a = await boot();
    const b = await boot();
    const log: string[] = [];
    const Menu = defineScene("Menu", () => {
      onEnter(() => {
        log.push("old");
      });
    });
    const Menu2 = defineScene("Menu", () => {
      onEnter(() => {
        log.push("new");
      });
    });
    await install(a, Menu);
    await install(b, Menu);

    const report = await hotReplaceScene(Menu, Menu2);
    expect(report).toEqual({ status: "applied", kind: "scene", name: "Menu", count: 2 });
    await a.hooks.callHook("scene:enter", "Menu");
    await b.hooks.callHook("scene:enter", "Menu");

    expect(log).toEqual(["new", "new"]);
  });

  it("a scene nothing installed applies with count 0", async () => {
    const Menu = defineScene("Menu", () => {});
    const Menu2 = defineScene("Menu", () => {});

    const report = await hotReplaceScene(Menu, Menu2);

    expect(report).toEqual({ status: "applied", kind: "scene", name: "Menu", count: 0 });
  });

  it("50 swaps keep the hook listener count of the engine", async () => {
    const engine = await boot();
    const Menu = defineScene("Menu", () => {
      onEnter(() => {});
      onExit(() => {});
    });
    await install(engine, Menu);
    const baseline = engine.getStats().hookListeners;
    let current = Menu;
    let applied = 0;
    for (let i = 0; i < 50; i++) {
      const next = defineScene("Menu", () => {
        onEnter(() => {});
        onExit(() => {});
      });
      const report = await hotReplaceScene(current, next);
      if (report.status === "applied") applied += report.count;
      current = next;
    }

    expect(applied).toBe(50);
    expect(engine.getStats().hookListeners).toBe(baseline);
  });

  it("a non-running engine returns reload engine-not-running", async () => {
    const engine = await boot();
    const Menu = defineScene("Menu", () => {});
    const Menu2 = defineScene("Menu", () => {});
    await install(engine, Menu);
    const stopping = engine.stop();

    const report = await hotReplaceScene(Menu, Menu2);
    expect(report).toEqual({
      status: "reload",
      kind: "scene",
      name: "Menu",
      reason: "engine-not-running",
    });
    await stopping;
  });

  it("a throwing new factory keeps the old scene installed and emits CORE:PLUGIN_RUNTIME_ERROR", async () => {
    const engine = await boot();
    const log: string[] = [];
    const emitted: string[] = [];
    engine.hooks.hook("engine:error", (error) => {
      emitted.push(error.code);
    });
    const Menu = defineScene("Menu", () => {
      onEnter(() => {
        log.push("old");
      });
    });
    const Broken = defineScene("Menu", () => {
      throw new Error("boom");
    });
    await install(engine, Menu);

    const report = await hotReplaceScene(Menu, Broken);
    expect(report).toEqual({ status: "applied", kind: "scene", name: "Menu", count: 0 });
    await engine.hooks.callHook("scene:enter", "Menu");

    expect(emitted).toEqual(["CORE:PLUGIN_RUNTIME_ERROR"]);
    expect(log).toEqual(["old"]);
  });

  it("after stop() the scene has no install and a swap applies with count 0", async () => {
    const engine = await boot();
    const Menu = defineScene("Menu", () => {
      onEnter(() => {});
    });
    const Menu2 = defineScene("Menu", () => {});
    await install(engine, Menu);
    await engine.stop();

    const report = await hotReplaceScene(Menu, Menu2);

    expect(report).toEqual({ status: "applied", kind: "scene", name: "Menu", count: 0 });
  });

  it("a swap requested inside onUpdate applies only after the frame", async () => {
    const engine = await boot();
    let oldRuns = 0;
    let newRuns = 0;
    let swap: Promise<GwenHotReport> | undefined;
    const Tick = defineSystem("Tick", () => {
      onUpdate(() => {
        oldRuns++;
        swap ??= hotReplaceScene(Game, Game2);
      });
    });
    const Tick2 = defineSystem("Tick", () => {
      onUpdate(() => {
        newRuns++;
      });
    });
    const Game = defineScene("Game", () => {
      useSystem(Tick());
    });
    const Game2 = defineScene("Game", () => {
      useSystem(Tick2());
    });
    await install(engine, Game);
    await engine.hooks.callHook("scene:enter", "Game");

    await engine.advance(0.016);
    const sameFrame = { oldRuns, newRuns };
    const report = await swap;

    expect(report).toEqual({ status: "applied", kind: "scene", name: "Game", count: 1 });
    expect(sameFrame).toEqual({ oldRuns: 1, newRuns: 0 });
    await engine.advance(0.016);
    expect({ oldRuns, newRuns }).toEqual({ oldRuns: 1, newRuns: 1 });
  });

  it("after a swap entering the scene resumes the added system and leaving it pauses it", async () => {
    const engine = await boot();
    const log: string[] = [];
    const Added = ticker("Added", "added", log);
    const Game = defineScene("Game", () => {});
    const Game2 = defineScene("Game", () => {
      useSystem(Added());
    });
    const def = engine.run(() => Game(REGISTRY));
    registerSceneHandles(engine, def.name, def.handles);
    for (const plugin of def.systems) await engine.use(plugin);

    const report = await hotReplaceScene(Game, Game2);

    expect(report).toEqual({ status: "applied", kind: "scene", name: "Game", count: 1 });
    await engine.hooks.callHook("scene:enter", "Game");
    await engine.advance(0.016);
    const afterEnter = [...log];
    log.length = 0;
    await engine.hooks.callHook("scene:beforeLeave", "Game");
    await engine.advance(0.016);
    expect(afterEnter).toEqual(["added"]);
    expect(log).toEqual([]);
  });

  it("a system removed by a swap is destroyed and no longer resumed", async () => {
    const engine = await boot();
    const log: string[] = [];
    const Keep = ticker("Keep", "keep", log);
    const Gone = ticker("Gone", "gone", log);
    let goneHandle: SystemHandle | undefined;
    const Level = defineScene("Level", () => {
      useSystem(Keep());
      goneHandle = useSystem(Gone());
    });
    const Level2 = defineScene("Level", () => {
      useSystem(Keep());
    });
    const def = await install(engine, Level);
    for (const handle of def.handles) handle._scenePause();

    const report = await hotReplaceScene(Level, Level2);

    expect(report).toEqual({ status: "applied", kind: "scene", name: "Level", count: 1 });
    expect(goneHandle?.active).toBe(false);
    await engine.hooks.callHook("scene:enter", "Level");
    await engine.advance(0.016);
    expect(log).toEqual(["keep"]);
    expect(goneHandle?.active).toBe(false);
  });

  it("a unuse rejected with CORE:PLUGIN_IN_USE reports reload plugin-in-use", async () => {
    const engine = await boot();
    const Gone = ticker("gone", "gone", []);
    const Level = defineScene("Level", () => {
      useSystem(Gone());
    });
    const Level2 = defineScene("Level", () => {});
    await install(engine, Level);
    await engine.use({
      name: "holder",
      requires: { plugins: ["gone"] },
      setup() {},
    });

    const report = await hotReplaceScene(Level, Level2);

    expect(report).toEqual({
      status: "reload",
      kind: "scene",
      name: "Level",
      reason: "plugin-in-use",
      detail: "gone",
    });
  });
});

describe("SceneEnginePlugin", () => {
  it("entering a scene resumes its handles and leaving it pauses them", async () => {
    const engine = await boot();
    const Game = defineScene("Game", () => {
      useSystem(ticker("Tick", "tick", [])());
    });
    const def = engine.run(() => Game(REGISTRY));
    registerSceneHandles(engine, def.name, def.handles);
    for (const plugin of def.systems) await engine.use(plugin);
    for (const handle of def.handles) handle._scenePause();

    await engine.hooks.callHook("scene:enter", "Game");
    const afterEnter = def.handles.map((handle) => handle.active);
    await engine.hooks.callHook("scene:beforeLeave", "Game");
    const afterLeave = def.handles.map((handle) => handle.active);

    expect(afterEnter).toEqual([true]);
    expect(afterLeave).toEqual([false]);
  });

  it("unhookScene removes the handlers of one scene and keeps the others", async () => {
    const engine = await boot();
    const log: string[] = [];
    const A = defineScene("A", () => {
      onEnter(() => {
        log.push("A");
      });
    });
    const B = defineScene("B", () => {
      onEnter(() => {
        log.push("B");
      });
    });
    await install(engine, A);
    await install(engine, B);
    const registry = engine.tryInject("scene:hook-registry");

    registry?.unhookScene("A");
    await engine.hooks.callHook("scene:enter", "A");
    await engine.hooks.callHook("scene:enter", "B");

    expect(log).toEqual(["B"]);
  });

  it("hookScene on a name that is already hooked registers nothing twice", async () => {
    const engine = await boot();
    const log: string[] = [];
    const Menu = defineScene("Menu", () => {
      onEnter(() => {
        log.push("enter");
      });
    });
    const def = engine.run(() => Menu(REGISTRY));
    const registry = engine.tryInject("scene:hook-registry");

    registry?.hookScene(engine, def);
    await engine.hooks.callHook("scene:enter", "Menu");

    expect(log).toEqual(["enter"]);
  });
});

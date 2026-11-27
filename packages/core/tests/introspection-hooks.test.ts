/**
 * @file Dev introspection hooks: listener counts per hook name and `revisions().hooks`.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { GwenIntrospection } from "@gwenjs/schema";
import type { GwenEngine, GwenEngineOptions } from "../src/index.js";
import { createEngine } from "../src/node.js";
import { hotReplaceSystem } from "../src/internal.js";
import { useHook } from "../src/hooks/index.js";
import { ScopedHookable } from "../src/hooks/scoped-hookable.js";
import { defineSystem, onRender, onUpdate } from "../src/system/index.js";
import "./support/plugin-registry";

const engines: GwenEngine[] = [];

async function open(options?: GwenEngineOptions): Promise<GwenEngine> {
  const engine = await createEngine(options);
  engines.push(engine);
  await engine.startExternal();
  return engine;
}

function introOf(engine: GwenEngine): GwenIntrospection {
  const intro = engine.tryInject("introspection");
  if (intro === undefined) throw new Error("the dev engine has no introspection service");
  return intro;
}

/** Listeners `hooks()` reports on `name`, 0 when the hook is not listed. */
function countOf(intro: GwenIntrospection, name: string): number {
  return intro.hooks().find((row) => row.name === name)?.count ?? 0;
}

const FRAME = 1 / 60;

afterEach(async () => {
  const pending = engines.splice(0);
  for (const engine of pending) await engine.stop();
});

describe.runIf(__GWEN_DEV__)("introspection hooks", () => {
  it("counts follow subscribe, unsubscribe fn, removeHook, scope dispose and unuse", async () => {
    const engine = await open();
    const intro = introOf(engine);
    const base = countOf(intro, "engine:update");
    const off = engine.hooks.hook("engine:update", () => {});
    expect(countOf(intro, "engine:update")).toBe(base + 1);
    off();
    expect(countOf(intro, "engine:update")).toBe(base);
    const listener = (): void => {};
    engine.hooks.hook("engine:update", listener);
    expect(countOf(intro, "engine:update")).toBe(base + 1);
    engine.hooks.removeHook("engine:update", listener);
    expect(countOf(intro, "engine:update")).toBe(base);
    const scope = new ScopedHookable(engine.hooks);
    scope.hook("engine:update", () => {});
    scope.hook("engine:update", () => {});
    expect(countOf(intro, "engine:update")).toBe(base + 2);
    scope.dispose();
    expect(countOf(intro, "engine:update")).toBe(base);
    await engine.use({
      name: "listeners",
      setup(host) {
        host.hooks.hook("engine:update", () => {});
        useHook("engine:render", () => {});
      },
    });
    expect(countOf(intro, "engine:update")).toBe(base + 1);
    expect(countOf(intro, "engine:render")).toBe(1);
    await engine.unuse("listeners");
    expect(countOf(intro, "engine:update")).toBe(base);
    expect(countOf(intro, "engine:render")).toBe(0);
  });

  it("a hook whose last listener left is not listed", async () => {
    const engine = await open();
    const intro = introOf(engine);
    const off = engine.hooks.hook("scene:preload", () => {});
    expect(intro.hooks().filter((row) => row.name === "scene:preload")).toEqual([
      { name: "scene:preload", count: 1 },
    ]);
    off();
    expect(intro.hooks().some((row) => row.name === "scene:preload")).toBe(false);
  });

  it("two listeners on one hook count 2 and the rows are sorted by name", async () => {
    const engine = await open();
    const intro = introOf(engine);
    const update = countOf(intro, "engine:update");
    const render = countOf(intro, "engine:render");
    const spawn = countOf(intro, "entity:spawn");
    engine.hooks.hook("engine:update", () => {});
    engine.hooks.hook("engine:update", () => {});
    engine.hooks.hook("engine:render", () => {});
    engine.hooks.hook("entity:spawn", () => {});
    expect(countOf(intro, "engine:update")).toBe(update + 2);
    expect(countOf(intro, "engine:render")).toBe(render + 1);
    expect(countOf(intro, "entity:spawn")).toBe(spawn + 1);
    const names = intro.hooks().map((row) => row.name);
    expect(names).toContain("engine:update");
    expect(names).toEqual([...names].sort());
  });

  it("rows are frozen and each read returns a new array", async () => {
    const engine = await open();
    const intro = introOf(engine);
    engine.hooks.hook("scene:preload", () => {});
    const first = intro.hooks();
    expect(first.find((row) => row.name === "scene:preload")?.count).toBe(1);
    expect(Object.isFrozen(first)).toBe(true);
    for (const row of first) expect(Object.isFrozen(row)).toBe(true);
    expect(intro.hooks()).not.toBe(first);
    expect(intro.hooks()).toEqual(first);
  });

  it("two engines keep their own counts", async () => {
    const first = await open();
    const second = await open();
    first.hooks.hook("scene:preload", () => {});
    expect(countOf(introOf(first), "scene:preload")).toBe(1);
    expect(countOf(introOf(second), "scene:preload")).toBe(0);
    second.hooks.hook("scene:preload", () => {});
    second.hooks.hook("scene:preload", () => {});
    expect(countOf(introOf(second), "scene:preload")).toBe(2);
    expect(countOf(introOf(first), "scene:preload")).toBe(1);
  });

  it("the scene recorder of the provider is not counted", async () => {
    const engine = await open();
    const intro = introOf(engine);
    engine.hooks.hook("scene:enter", () => {});
    expect(countOf(intro, "scene:enter")).toBe(1);
    expect(countOf(intro, "scene:leave")).toBe(0);
  });

  it("a hookOnce listener leaves the count after it fires", async () => {
    const engine = await open();
    const intro = introOf(engine);
    const base = countOf(intro, "engine:update");
    engine.hooks.hookOnce("engine:update", () => {});
    expect(countOf(intro, "engine:update")).toBe(base + 1);
    await engine.advance(FRAME);
    expect(countOf(intro, "engine:update")).toBe(base);
  });

  it("revisions().hooks moves when a listener is added or removed and not otherwise", async () => {
    const engine = await open();
    const intro = introOf(engine);
    const before = intro.revisions();
    expect(intro.revisions().hooks).toBe(before.hooks);
    const off = engine.hooks.hook("scene:preload", () => {});
    const added = intro.revisions();
    expect(added.hooks).toBe(before.hooks + 1);
    expect(intro.revisions().hooks).toBe(added.hooks);
    const offSecond = engine.hooks.hook("scene:preload", () => {});
    expect(intro.revisions().hooks).toBe(added.hooks + 1);
    offSecond();
    off();
    const removed = intro.revisions();
    expect(removed.hooks).toBe(added.hooks + 2);
    expect(removed.plugins).toBe(before.plugins);
    expect(removed.services).toBe(before.services);
  });

  it("a system's handlers are counted on its phase hooks until unuse", async () => {
    const probe = defineSystem("probe", () => {
      onUpdate(() => {});
      onUpdate(() => {});
      onRender(() => {});
    });
    const engine = await open();
    const intro = introOf(engine);
    const update = countOf(intro, "engine:update");
    const render = countOf(intro, "engine:render");
    await engine.use(probe());
    expect(countOf(intro, "engine:update")).toBe(update + 2);
    expect(countOf(intro, "engine:render")).toBe(render + 1);
    await engine.unuse("probe");
    expect(countOf(intro, "engine:update")).toBe(update);
    expect(countOf(intro, "engine:render")).toBe(render);
  });

  it("a hot swap keeps the handlers it re-uses and drops the ones it no longer registers", async () => {
    const make = (handlers: number) =>
      defineSystem("swapme", () => {
        for (let i = 0; i < handlers; i += 1) onUpdate(() => {});
      });
    const first = make(3);
    const engine = await open();
    const intro = introOf(engine);
    const base = countOf(intro, "engine:update");
    await engine.use(first());
    expect(countOf(intro, "engine:update")).toBe(base + 3);
    const second = make(1);
    await hotReplaceSystem(first, second);
    expect(countOf(intro, "engine:update")).toBe(base + 1);
    await hotReplaceSystem(second, make(2));
    expect(countOf(intro, "engine:update")).toBe(base + 2);
  });

  it("after stop() a plugin listener is no longer counted and the read does not throw", async () => {
    const engine = await open();
    const intro = introOf(engine);
    await engine.use({
      name: "keeper",
      setup(host) {
        host.hooks.hook("scene:preload", () => {});
      },
    });
    expect(countOf(intro, "scene:preload")).toBe(1);
    await engine.stop();
    expect(countOf(intro, "scene:preload")).toBe(0);
  });
});

/**
 * @file Dev introspection scene stack: enter, transition, overlay, two engines, stop.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { GwenEngine, GwenPlugin } from "../src/index.js";
import { createEngine } from "../src/node.js";
import { defineScene, defineSceneRouter, useSceneRouter } from "../src/scene/index.js";
import { defineComponent, Types } from "../src/schema.js";
import { countHookListeners } from "../src/engine/hook-dispatch.js";

const engines: GwenEngine[] = [];

async function open(): Promise<GwenEngine> {
  const engine = await createEngine();
  engines.push(engine);
  return engine;
}

afterEach(async () => {
  const pending = engines.splice(0);
  for (const engine of pending) await engine.stop();
});

function routerOf() {
  const Menu = defineScene("Menu", () => {});
  const Game = defineScene("Game", () => {});
  const Pause = defineScene("Pause", () => {});
  return defineSceneRouter({
    initial: "menu",
    routes: {
      menu: { scene: Menu, on: { PLAY: "game" } },
      game: { scene: Game, on: { PAUSE: "pause" } },
      pause: { scene: Pause, overlay: true, on: { RESUME: "game" } },
    },
  });
}

describe.runIf(__GWEN_DEV__)("introspection scenes", () => {
  it("initial enter, transition, overlay push and pop give the expected stack", async () => {
    const engine = await open();
    const nav = engine.run(() => useSceneRouter(routerOf()));
    const intro = engine.tryInject("introspection");
    expect(intro?.snapshot()?.scenes).toEqual([]);
    if (intro === undefined) return;
    await engine.hooks.callHook("scene:enter", "Menu");
    expect(intro.snapshot().scenes).toEqual(["Menu"]);
    await nav.send("PLAY");
    expect(intro.snapshot().scenes).toEqual(["Game"]);
    await nav.send("PAUSE");
    expect(intro.snapshot().scenes).toEqual(["Game", "Pause"]);
    await nav.send("RESUME");
    expect(intro.snapshot().scenes).toEqual(["Game"]);
  });

  it("a scene:leave of an unknown name does not move revisions().scenes", async () => {
    const engine = await open();
    const intro = engine.tryInject("introspection");
    expect(intro).toBeDefined();
    if (intro === undefined) return;
    await engine.hooks.callHook("scene:enter", "Menu");
    const before = intro.revisions().scenes;
    await engine.hooks.callHook("scene:leave", "Nope");
    expect(intro.snapshot().scenes).toEqual(["Menu"]);
    expect(intro.revisions().scenes).toBe(before);
  });

  it("a plugin reading after the initial enter still sees it", async () => {
    const engine = await open();
    let seen: readonly string[] | undefined;
    const reader: GwenPlugin = {
      name: "reader",
      setup(host) {
        host.hooks.hook("scene:enter", () => {
          seen = host.tryInject("introspection")?.snapshot().scenes;
        });
      },
    };
    await engine.use(reader);
    await engine.hooks.callHook("scene:enter", "Menu");
    expect(seen).toEqual(["Menu"]);
  });

  it("two engines keep separate stacks and records", async () => {
    const alpha = await open();
    const beta = await open();
    const onlyA: GwenPlugin = { name: "only-a", setup() {} };
    await alpha.use(onlyA);
    const Mark = defineComponent({ name: "Mark", schema: { n: Types.f32 } });
    alpha.addComponent(alpha.createEntity(), Mark, { n: 1 });
    await alpha.hooks.callHook("scene:enter", "Menu");
    await beta.hooks.callHook("scene:enter", "Game");
    const alphaShot = alpha.tryInject("introspection")?.snapshot();
    const betaShot = beta.tryInject("introspection")?.snapshot();
    expect(alphaShot?.scenes).toEqual(["Menu"]);
    expect(betaShot?.scenes).toEqual(["Game"]);
    if (alphaShot === undefined || betaShot === undefined) return;
    expect(alphaShot.plugins.map((plugin) => plugin.name)).toEqual(["only-a"]);
    expect(betaShot.plugins).toEqual([]);
    expect(alphaShot.components.map((component) => component.name)).toEqual(["Mark"]);
    expect(betaShot.components).toEqual([]);
  });

  it("stop() unhooks the scene recorder", async () => {
    const engine = await open();
    const intro = engine.tryInject("introspection");
    await engine.hooks.callHook("scene:enter", "Menu");
    expect(intro?.snapshot()?.scenes).toEqual(["Menu"]);
    if (intro === undefined) return;
    await engine.stop();
    const stopped = intro.snapshot();
    expect(stopped.state).toBe("stopped");
    expect(stopped.entityCount).toBe(0);
    await engine.hooks.callHook("scene:enter", "Game");
    expect(intro.snapshot().scenes).toEqual(["Menu"]);
  });

  it("stop() releases the recorder without hiding a plugin hook leak from hookListeners", async () => {
    const engine = await open();
    const intro = engine.tryInject("introspection");
    expect(intro).toBeDefined();
    if (intro === undefined) return;
    const before = countHookListeners(engine.hooks);
    const leaky: GwenPlugin = {
      name: "leaky",
      setup() {
        engine.hooks.hook("scene:enter", () => {});
      },
    };
    await engine.use(leaky);
    await engine.stop();
    expect(countHookListeners(engine.hooks)).toBe(before + 1);
  });
});

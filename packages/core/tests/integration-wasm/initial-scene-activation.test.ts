import { describe, expect, it } from "vitest";

import { defineActor, definePrefab, useActor } from "../../src/actor/index.js";
import type { GwenPlugin } from "../../src/engine/gwen-engine.js";
import { defineSceneRouter, useSceneRouter } from "../../src/router/index.js";
import { SceneEnginePlugin } from "../../src/scene/engine-plugin.js";
import { defineScene } from "../../src/scene/runtime/define-scene.js";
import { onEnter, useSystem } from "../../src/scene/runtime/scene-context.js";
import type { SystemHandle } from "../../src/scene/runtime/system-handle.js";
import { defineSystem, onUpdate } from "../../src/system/index.js";
import { createRealEngine } from "./harness.js";

const MAIN = "menu";

interface ActivationCounts {
  onEnterBeforeFrame: number;
  onEnterCount: number;
  actorCount: number;
  sceneEnterCount: number;
  resumeCount: number;
  routerCurrent: string | undefined;
  mainActive: boolean;
  otherActive: boolean;
}

/**
 * Replays the generated bootstrap sequence on a real engine:
 * wire scene factories inside engine.run, install scene systems,
 * pause non-main systems, install the scene:enter resume hook,
 * await one scene:enter for the main scene, then startExternal and advance.
 */
async function replayBootstrap(place: "none" | "host" | "routed-scene"): Promise<ActivationCounts> {
  const handle = await createRealEngine({ variant: "light", maxEntities: 64 });
  const { engine } = handle;
  const seenEnter: string[] = [];
  const onSceneEnter = (name: string): void => {
    seenEnter.push(name);
  };
  engine.hooks.hook("scene:enter", onSceneEnter);

  let onEnterCount = 0;
  let resumeCount = 0;
  let routerCurrent: string | undefined;
  let resumeHook: ((name: string) => void) | undefined;

  try {
    await engine.use(SceneEnginePlugin());

    const Prefab = definePrefab([]);
    const Player = defineActor(Prefab, () => ({ tag: "player" }));
    const OtherTick = defineSystem("other-tick", () => {});

    let router: ReturnType<typeof defineSceneRouter> | undefined;
    const MenuTick = defineSystem("menu-tick", () => {
      if (place !== "routed-scene" || !router) return;
      // onUpdate, not the setup body: useSceneRouter would re-enter this scene's factory.
      onUpdate(() => {
        if (router) routerCurrent = useSceneRouter(router).current;
      });
    });

    const Menu = defineScene(MAIN, () => {
      const player = useActor(Player);
      useSystem(MenuTick());
      onEnter(() => {
        onEnterCount += 1;
        player.spawnOnce();
      });
    });
    const Other = defineScene("other", () => {
      useSystem(OtherTick());
    });

    let Host: ReturnType<typeof defineScene> | undefined;
    if (place !== "none") {
      router = defineSceneRouter({
        initial: MAIN,
        routes: {
          menu: { scene: Menu, on: { GO: "other" } },
          other: { scene: Other, on: {} },
        },
      });
    }
    if (place === "host" && router) {
      // Created from a scene factory, which is the bootstrap moment that used
      // to emit scene:enter before the resume hook existed. This scene is not
      // itself a route: resolving the in-progress factory would re-enter it.
      const routed = router;
      Host = defineScene("host", () => {
        routerCurrent = useSceneRouter(routed).current;
      });
    }

    const handleMap = new Map<string, SystemHandle[]>();
    const plugins: GwenPlugin[] = [];
    engine.run(() => {
      const factories = Host ? [Menu, Other, Host] : [Menu, Other];
      for (const factory of factories) {
        const scene = factory({ register() {} });
        handleMap.set(scene.name, scene.handles);
        plugins.push(...scene.systems);
      }
    });
    for (const plugin of plugins) await engine.use(plugin);

    for (const [name, handles] of handleMap) {
      if (name !== MAIN) {
        for (const systemHandle of handles) systemHandle._scenePause();
      }
    }

    for (const handles of handleMap.values()) {
      for (const systemHandle of handles) {
        const original = systemHandle._sceneResume.bind(systemHandle);
        systemHandle._sceneResume = () => {
          resumeCount += 1;
          original();
        };
      }
    }

    resumeHook = (name: string) => {
      for (const systemHandle of handleMap.get(name) ?? []) systemHandle._sceneResume();
    };
    engine.hooks.hook("scene:enter", resumeHook);

    await engine.hooks.callHook("scene:enter", MAIN, undefined);
    const onEnterBeforeFrame = onEnterCount;
    await engine.startExternal();
    await engine.advance(1 / 60);

    const menuHandles = handleMap.get(MAIN) ?? [];
    const otherHandles = handleMap.get("other") ?? [];
    return {
      onEnterBeforeFrame,
      onEnterCount,
      actorCount: Player._instances.size,
      sceneEnterCount: seenEnter.length,
      resumeCount,
      routerCurrent,
      mainActive: menuHandles.length > 0 && menuHandles.every((item) => item.active),
      otherActive: otherHandles.some((item) => item.active),
    };
  } finally {
    engine.hooks.removeHook("scene:enter", onSceneEnter);
    if (resumeHook) engine.hooks.removeHook("scene:enter", resumeHook);
    await handle.dispose();
  }
}

describe("initial scene activation", () => {
  it("without a router, onEnter, scene:enter and resume run once", async () => {
    const counts = await replayBootstrap("none");
    expect(counts.onEnterBeforeFrame).toBe(1);
    expect(counts.onEnterCount).toBe(1);
    expect(counts.sceneEnterCount).toBe(1);
    expect(counts.resumeCount).toBe(1);
    expect(counts.actorCount).toBe(1);
    expect(counts.mainActive).toBe(true);
    expect(counts.otherActive).toBe(false);
    expect(counts.routerCurrent).toBeUndefined();
  });

  it("with a router created in a scene, activation still happens once", async () => {
    const counts = await replayBootstrap("host");
    expect(counts.routerCurrent).toBe(MAIN);
    expect(counts.onEnterBeforeFrame).toBe(1);
    expect(counts.onEnterCount).toBe(1);
    expect(counts.sceneEnterCount).toBe(1);
    expect(counts.resumeCount).toBe(1);
    expect(counts.actorCount).toBe(1);
    expect(counts.mainActive).toBe(true);
    expect(counts.otherActive).toBe(false);
  });

  it("with the router used from a system of a routed scene, activation still happens once", async () => {
    const counts = await replayBootstrap("routed-scene");
    expect(counts.routerCurrent).toBe(MAIN);
    expect(counts.onEnterBeforeFrame).toBe(1);
    expect(counts.onEnterCount).toBe(1);
    expect(counts.sceneEnterCount).toBe(1);
    expect(counts.resumeCount).toBe(1);
    expect(counts.actorCount).toBe(1);
    expect(counts.mainActive).toBe(true);
    expect(counts.otherActive).toBe(false);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import type { GwenErrorPayload } from "@gwenjs/schema";
import { createEngine } from "../../src/node.js";
import type { GwenEngine } from "../../src/engine/engine-types.js";
import { useEngine } from "../../src/engine/context.js";
import { GwenScenePreloadError } from "../../src/scene/scene-preload-error.js";
import { defineScene } from "../../src/scene/runtime/define-scene.js";
import { onEnter, onExit, onPreload, useSystem } from "../../src/scene/runtime/scene-context.js";
import { defineSceneRouter } from "../../src/router/defines/define-scene-router.js";
import { useSceneRouter } from "../../src/router/uses/use-scene-router.js";
import { defineSystem } from "../../src/system/index.js";

const MenuTick = defineSystem("preload-menu-tick", () => {});

function gate(): { promise: Promise<void>; open: () => void } {
  let open: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

/** Thrown value, or `undefined` when the promise resolves. */
async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return undefined;
  } catch (caught) {
    return caught;
  }
}

function watchLifecycle(engine: GwenEngine, log: string[]): void {
  engine.hooks.hook("scene:transition:leave", () => {
    log.push("transition:leave");
  });
  engine.hooks.hook("scene:beforeLeave", () => {
    log.push("beforeLeave");
  });
  engine.hooks.hook("scene:leave", () => {
    log.push("leave");
  });
  engine.hooks.hook("scene:enter", () => {
    log.push("enter");
  });
}

describe("useSceneRouter preload", () => {
  const engines: GwenEngine[] = [];

  async function loadEngine(): Promise<GwenEngine> {
    const engine = await createEngine();
    engines.push(engine);
    await engine.startExternal();
    return engine;
  }

  afterEach(async () => {
    const pending = engines.splice(0);
    for (const engine of pending) await engine.stop();
  });

  it("send() awaits every onPreload of the target before scene:transition:leave fires and the current scene keeps running", async () => {
    const engine = await loadEngine();
    const log: string[] = [];
    let exits = 0;
    let menuEnters = 0;
    let menuActive = (): boolean => false;
    const held = gate();
    const Menu = defineScene("Menu", () => {
      const handle = useSystem(MenuTick());
      menuActive = () => handle.active;
      onEnter(() => {
        menuEnters += 1;
      });
      onExit(() => {
        exits += 1;
      });
    });
    const Game = defineScene("Game", () => {
      onPreload(async () => {
        log.push("preload-1");
        await held.promise;
      });
      onPreload(async () => {
        log.push("preload-2");
        await held.promise;
      });
      onEnter(() => {});
    });
    const router = defineSceneRouter({
      initial: "menu",
      routes: {
        menu: { scene: Menu, on: { PLAY: "game" } },
        game: { scene: Game, on: {} },
      },
    });
    watchLifecycle(engine, log);
    const nav = engine.run(() => useSceneRouter(router));
    const pending = nav.send("PLAY");
    try {
      expect(log).toEqual(["preload-1", "preload-2"]);
      expect(nav.current).toBe("menu");
      expect(exits).toBe(0);
      expect(menuEnters).toBe(0);
      expect(menuActive()).toBe(true);
    } finally {
      held.open();
      await pending;
    }
    expect(log).toEqual([
      "preload-1",
      "preload-2",
      "transition:leave",
      "beforeLeave",
      "leave",
      "enter",
    ]);
  });

  it("progress goes 0 to 1 monotonically during send()", async () => {
    const engine = await loadEngine();
    const progress: number[] = [];
    engine.hooks.hook("scene:preload:progress", (payload) => {
      progress.push(payload.progress);
    });
    const Menu = defineScene("Menu", () => {});
    const Game = defineScene("Game", () => {
      onPreload((event) => {
        event.progress("a", 1, 2);
      });
      onPreload((event) => {
        event.progress("a", 2, 2);
      });
    });
    const router = defineSceneRouter({
      initial: "menu",
      routes: {
        menu: { scene: Menu, on: { PLAY: "game" } },
        game: { scene: Game, on: {} },
      },
    });
    const nav = engine.run(() => useSceneRouter(router));
    await nav.send("PLAY");
    expect(progress).toEqual([0, 0.5, 1]);
  });

  it("a rejected onPreload rejects send() with GwenScenePreloadError, keeps current and params, fires no leave or enter hook and reports one warning", async () => {
    const engine = await loadEngine();
    const boom = new Error("boom");
    const started: string[] = [];
    let attempts = 0;
    let exits = 0;
    let enters = 0;
    let transitions = 0;
    const hooks: string[] = [];
    const bus: GwenErrorPayload[] = [];
    const unsubscribe = engine.errors.on((event) => {
      bus.push(event);
    });
    const Menu = defineScene("Menu", () => {
      onEnter(() => {
        enters += 1;
      });
      onExit(() => {
        exits += 1;
      });
    });
    const Game = defineScene("Game", () => {
      onPreload(() => {
        started.push("first");
      });
      onPreload(() => {
        attempts += 1;
        if (attempts === 1) throw boom;
      });
      onEnter(() => {
        enters += 1;
      });
    });
    const router = defineSceneRouter({
      initial: "menu",
      routes: {
        menu: { scene: Menu, on: { PLAY: "game" } },
        game: { scene: Game, on: {} },
      },
    });
    watchLifecycle(engine, hooks);
    engine.hooks.hook("scene:transition:enter", () => {
      hooks.push("transition:enter");
    });
    const nav = engine.run(() => useSceneRouter(router));
    const unsubscribeTransition = nav.onTransition(() => {
      transitions += 1;
    });
    try {
      const error = await rejectionOf(nav.send("PLAY", { level: 2 }));
      expect(error).toBeInstanceOf(GwenScenePreloadError);
      if (!(error instanceof GwenScenePreloadError)) return;
      expect(error.code).toBe("CORE:SCENE_PRELOAD_FAILED");
      expect(error.cause).toBe(boom);
      expect(nav.current).toBe("menu");
      expect(nav.params).toEqual({});
      expect(exits).toBe(0);
      expect(enters).toBe(0);
      expect(transitions).toBe(0);
      expect(hooks).toEqual([]);
      expect(started).toEqual(["first"]);
      expect(engine.state).toBe("running");
      const reported = bus.filter((event) => event.code === "CORE:SCENE_PRELOAD_FAILED");
      expect(reported).toHaveLength(1);
      const event = reported[0];
      if (event === undefined) return;
      expect(event.level).toBe("warning");
      expect(event.source).toBe("scene:Game");
      expect("target" in event).toBe(false);
      await nav.send("PLAY");
      expect(nav.current).toBe("game");
    } finally {
      unsubscribeTransition();
      unsubscribe();
    }
  });

  it("a failed overlay push leaves the overlay stack empty, so re-entering the underlying scene still fires scene:enter", async () => {
    const engine = await loadEngine();
    let enters = 0;
    const Game = defineScene("Game", () => {
      onEnter(() => {
        enters += 1;
      });
    });
    const Pause = defineScene("Pause", () => {
      onPreload(() => {
        throw new Error("pause-boom");
      });
    });
    const Menu = defineScene("Menu", () => {});
    const router = defineSceneRouter({
      initial: "game",
      routes: {
        game: { scene: Game, on: { PAUSE: "pause", QUIT: "menu" } },
        pause: { scene: Pause, overlay: true, on: { RESUME: "game" } },
        menu: { scene: Menu, on: { PLAY: "game" } },
      },
    });
    const nav = engine.run(() => useSceneRouter(router));
    const error = await rejectionOf(nav.send("PAUSE"));
    expect(error).toBeInstanceOf(GwenScenePreloadError);
    expect(nav.current).toBe("game");
    await nav.send("QUIT");
    await nav.send("PLAY");
    expect(enters).toBe(1);
  });

  it("overlay push preloads the target before the stack changes and dismiss runs no preload", async () => {
    const engine = await loadEngine();
    let preloads = 0;
    let currentDuringPreload = "";
    const readCurrent = { value: (): string => "" };
    const Game = defineScene("Game", () => {});
    const Pause = defineScene("Pause", () => {
      onPreload(() => {
        preloads += 1;
        currentDuringPreload = readCurrent.value();
      });
    });
    const router = defineSceneRouter({
      initial: "game",
      routes: {
        game: { scene: Game, on: { PAUSE: "pause" } },
        pause: { scene: Pause, overlay: true, on: { RESUME: "game" } },
      },
    });
    const nav = engine.run(() => useSceneRouter(router));
    readCurrent.value = () => nav.current;
    await nav.send("PAUSE");
    expect(preloads).toBe(1);
    expect(currentDuringPreload).toBe("game");
    expect(nav.current).toBe("pause");
    await nav.send("RESUME");
    expect(preloads).toBe(1);
    expect(nav.current).toBe("game");
  });

  it("send() during a pending preload is ignored with a warning", async () => {
    const engine = await loadEngine();
    const held = gate();
    const warn = vi.spyOn(engine.logger, "warn");
    const Menu = defineScene("Menu", () => {});
    const Game = defineScene("Game", () => {
      onPreload(async () => {
        await held.promise;
      });
    });
    const Options = defineScene("Options", () => {});
    const router = defineSceneRouter({
      initial: "menu",
      routes: {
        menu: { scene: Menu, on: { PLAY: "game", OPTIONS: "options" } },
        game: { scene: Game, on: {} },
        options: { scene: Options, on: {} },
      },
    });
    const nav = engine.run(() => useSceneRouter(router));
    // `pending` will store the route state (`target`), which is "game", not the scene name "Game".
    const pending = nav.send("PLAY");
    try {
      await nav.send("OPTIONS");
      expect(warn).toHaveBeenCalledWith(
        'useSceneRouter: send("OPTIONS") ignored while a transition to "game" is pending.',
      );
      expect(nav.current).toBe("menu");
    } finally {
      held.open();
      warn.mockRestore();
      await pending;
    }
    expect(nav.current).toBe("game");
  });

  it("two scenes with onPreload preload independently", async () => {
    const engine = await loadEngine();
    const log: string[] = [];
    const Menu = defineScene("Menu", () => {});
    const Game = defineScene("Game", () => {
      onPreload(() => {
        log.push("game");
      });
    });
    const Options = defineScene("Options", () => {
      onPreload(() => {
        log.push("options");
      });
    });
    const router = defineSceneRouter({
      initial: "menu",
      routes: {
        menu: { scene: Menu, on: { PLAY: "game", OPTIONS: "options" } },
        game: { scene: Game, on: {} },
        options: { scene: Options, on: {} },
      },
    });
    const nav = engine.run(() => useSceneRouter(router));
    await nav.send("PLAY");
    expect(log).toEqual(["game"]);
  });

  it("a scene with no onPreload still reports progress 0 then 1 and transitions as before", async () => {
    const engine = await loadEngine();
    const progress: number[] = [];
    engine.hooks.hook("scene:preload:progress", (payload) => {
      progress.push(payload.progress);
    });
    const Menu = defineScene("Menu", () => {});
    const Options = defineScene("Options", () => {});
    const router = defineSceneRouter({
      initial: "menu",
      routes: {
        menu: { scene: Menu, on: { OPTIONS: "options" } },
        options: { scene: Options, on: {} },
      },
    });
    const nav = engine.run(() => useSceneRouter(router));
    await nav.send("OPTIONS");
    expect(progress).toEqual([0, 1]);
    expect(nav.current).toBe("options");
  });

  it("two engines preload independently while one send() is pending", async () => {
    const engineA = await loadEngine();
    const engineB = await loadEngine();
    const logA: string[] = [];
    const logB: string[] = [];
    const held = gate();
    const Menu = defineScene("Menu", () => {});
    const Game = defineScene("Game", () => {
      onPreload(async () => {
        const current = useEngine();
        if (current === engineA) {
          logA.push("a-preload");
          await held.promise;
          return;
        }
        if (current === engineB) logB.push("b-preload");
      });
    });
    const router = defineSceneRouter({
      initial: "menu",
      routes: {
        menu: { scene: Menu, on: { PLAY: "game" } },
        game: { scene: Game, on: {} },
      },
    });
    const navA = engineA.run(() => useSceneRouter(router));
    const navB = engineB.run(() => useSceneRouter(router));
    const pendingA = navA.send("PLAY");
    try {
      await navB.send("PLAY");
      expect(logB).toEqual(["b-preload"]);
      expect(navA.current).toBe("menu");
    } finally {
      held.open();
      await pendingA;
    }
    expect(logA).toEqual(["a-preload"]);
    expect(navA.current).toBe("game");
    expect(navB.current).toBe("game");
  });
});

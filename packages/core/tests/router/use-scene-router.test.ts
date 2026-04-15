import { describe, it, expect, vi } from "vitest";
import { createEngine } from "../../src/engine/gwen-engine.js";
import { defineScene } from "../../src/scene/runtime/define-scene";
import { definePrefab } from "../../src/actor/runtime/define-prefab";
import { defineActor } from "../../src/actor/runtime/define-actor";
import { useActor } from "../../src/actor/runtime/use-actor";
import { onEnter, onExit } from "../../src/scene/runtime/scene-context";
import { defineSceneRouter } from "../../src/router/defines/define-scene-router";
import { useSceneRouter } from "../../src/router/uses/use-scene-router";

const onEnterMenu = vi.fn();
const onExitMenu = vi.fn();
const onEnterGame = vi.fn();

const MenuScene = defineScene("Menu", () => {
  onEnter(onEnterMenu);
  onExit(onExitMenu);
});
const GameScene = defineScene("Game", () => {
  onEnter(onEnterGame);
});
const PauseScene = defineScene("Pause", () => {});

const AppRouter = defineSceneRouter({
  initial: "menu",
  routes: {
    menu: { scene: MenuScene, on: { PLAY: "game" } },
    game: { scene: GameScene, on: { PAUSE: "pause", WIN: "menu" } },
    pause: { scene: PauseScene, overlay: true, on: { RESUME: "game", QUIT: "menu" } },
  },
});

const Position = { __name__: "Position" };

describe("useSceneRouter()", () => {
  it("starts in the initial state", async () => {
    const engine = await createEngine();
    await engine.run(async () => {
      const nav = useSceneRouter(AppRouter);
      expect(nav.current).toBe("menu");
    });
  });

  it("send() transitions to new state", async () => {
    const engine = await createEngine();
    await engine.run(async () => {
      const nav = useSceneRouter(AppRouter);
      await nav.send("PLAY");
      expect(nav.current).toBe("game");
    });
  });

  it("send() calls onExit of previous scene and onEnter of next", async () => {
    onEnterMenu.mockClear();
    onExitMenu.mockClear();
    onEnterGame.mockClear();
    const engine = await createEngine();
    await engine.run(async () => {
      const nav = useSceneRouter(AppRouter);
      await nav.send("PLAY");
      expect(onExitMenu).toHaveBeenCalledOnce();
      expect(onEnterGame).toHaveBeenCalledOnce();
    });
  });

  it("send() passes params to onEnter of target scene", async () => {
    const onEnterSpy = vi.fn();
    const SceneA = defineScene("A", () => {});
    const SceneB = defineScene("B", () => {
      onEnter(onEnterSpy);
    });
    const router = defineSceneRouter({
      initial: "a",
      routes: {
        a: { scene: SceneA, on: { GO: "b" } },
        b: { scene: SceneB, on: {} },
      },
    });
    const engine = await createEngine();
    await engine.run(async () => {
      const nav = useSceneRouter(router);
      await nav.send("GO", { level: 2, score: 999 });
    });
    expect(onEnterSpy).toHaveBeenCalledWith(expect.objectContaining({ level: 2, score: 999 }));
  });

  it("send() with invalid event is silently ignored", async () => {
    const engine = await createEngine();
    await engine.run(async () => {
      const nav = useSceneRouter(AppRouter);
      await expect(nav.send("WIN" as any)).resolves.toBeUndefined();
      expect(nav.current).toBe("menu");
    });
  });

  it("can() returns true only for valid transitions in current state", async () => {
    const engine = await createEngine();
    await engine.run(async () => {
      const nav = useSceneRouter(AppRouter);
      expect(nav.can("PLAY")).toBe(true);
      expect(nav.can("WIN" as any)).toBe(false);
    });
  });

  it("onTransition() callback is called on state change", async () => {
    const engine = await createEngine();
    const transitions: [string, string][] = [];
    await engine.run(async () => {
      const nav = useSceneRouter(AppRouter);
      nav.onTransition((from, to) => transitions.push([from, to]));
      await nav.send("PLAY");
    });
    expect(transitions).toEqual([["menu", "game"]]);
  });

  it("overlay: true pushes scene on stack, RESUME pops back", async () => {
    const engine = await createEngine();
    await engine.run(async () => {
      const nav = useSceneRouter(AppRouter);
      await nav.send("PLAY");
      expect(nav.current).toBe("game");
      await nav.send("PAUSE");
      expect(nav.current).toBe("pause");
      await nav.send("RESUME");
      expect(nav.current).toBe("game");
    });
  });

  it("params are stored and accessible after send()", async () => {
    const engine = await createEngine();
    await engine.run(async () => {
      const nav = useSceneRouter(AppRouter);
      await nav.send("PLAY", { debug: true });
      expect(nav.params).toEqual({ debug: true });
    });
  });

  it("allows scenes to spawn actors on enter without manual plugin setup", async () => {
    const PlayerPrefab = definePrefab([{ def: Position, defaults: { x: 0, y: 0 } }]);
    const PlayerActor = defineActor(PlayerPrefab, () => ({ tag: "player" }));

    const Menu = defineScene("MenuWithActorSpawn", () => {});
    const Game = defineScene("GameWithActorSpawn", () => {
      const player = useActor(PlayerActor);
      onEnter(() => {
        player.spawnOnce();
      });
    });
    const router = defineSceneRouter({
      initial: "menu",
      routes: {
        menu: { scene: Menu, on: { PLAY: "game" } },
        game: { scene: Game, on: {} },
      },
    });

    const engine = await createEngine();
    const usages: Promise<unknown>[] = [];
    engine.run(() => {
      for (const sceneFactory of [Menu, Game]) {
        const scene = sceneFactory({ register: () => {} });
        for (const plugin of scene.systems) usages.push(engine.use(plugin));
      }
    });
    await Promise.all(usages);

    await engine.run(async () => {
      const nav = useSceneRouter(router);
      await expect(nav.send("PLAY")).resolves.toBeUndefined();
    });

    expect(PlayerActor._instances.size).toBe(1);
  });

  it("throws if used outside engine context", () => {
    expect(() => useSceneRouter(AppRouter)).toThrow(/useSceneRouter.*engine/i);
  });
});

describe("useSceneRouter — engine:stop cleanup", () => {
  it("clears onTransition listeners when the engine stops", async () => {
    const engine = await createEngine();
    const A = defineScene("CleanupA", () => {});
    const B = defineScene("CleanupB", () => {});
    const SimpleRouter = defineSceneRouter({
      initial: "a",
      routes: {
        a: { scene: A, on: { GO: "b" } },
        b: { scene: B, on: {} },
      },
    });

    let handle!: ReturnType<typeof useSceneRouter<typeof SimpleRouter.options.routes>>;
    engine.run(() => {
      handle = useSceneRouter(SimpleRouter);
    });

    const listener = vi.fn();
    handle.onTransition(listener);

    await engine.stop();

    // Listeners array must have been cleared by the engine:stop hook.
    // Calling send() now should not invoke the listener.
    await handle.send("GO");
    expect(listener).not.toHaveBeenCalled();
  });
});

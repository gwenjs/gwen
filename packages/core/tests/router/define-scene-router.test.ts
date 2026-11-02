import { describe, it, expect } from "vitest";
import * as core from "../../src/index.js";
import { defineScene, type SceneFactory } from "../../src/scene/runtime/define-scene";
import { defineSceneRouter } from "../../src/router/defines/define-scene-router";

const MenuScene = defineScene("Menu", () => {});
const GameScene = defineScene("Game", () => {});
const PauseScene = defineScene("Pause", () => {});

describe("defineSceneRouter()", () => {
  it("returns a SceneRouterDefinition with __type marker", () => {
    const router = defineSceneRouter({
      initial: "menu",
      routes: {
        menu: { scene: MenuScene, on: { PLAY: "game" } },
        game: { scene: GameScene, on: { PAUSE: "pause" } },
        pause: { scene: PauseScene, overlay: true, on: { RESUME: "game" } },
      },
    });
    expect(router.__type).toBe("SceneRouterDefinition");
  });

  it("stores the options as-is", () => {
    const options = {
      initial: "menu" as const,
      routes: {
        menu: { scene: MenuScene, on: { PLAY: "game" as const } },
        game: { scene: GameScene, on: {} },
      },
    };
    const router = defineSceneRouter(options);
    expect(router.options).toBe(options);
  });

  it("throws if initial state is not a key in routes", () => {
    expect(() =>
      defineSceneRouter({
        initial: "unknown" as any,
        routes: {
          menu: { scene: MenuScene, on: {} },
        },
      }),
    ).toThrow(/initial.*not found/i);
  });

  it("throws if a transition target is not a valid route key", () => {
    expect(() =>
      defineSceneRouter({
        initial: "menu",
        routes: {
          menu: { scene: MenuScene, on: { PLAY: "nonexistent" as any } },
        },
      }),
    ).toThrow(/transition.*nonexistent/i);
  });

  it("an unknown initial throws GwenSceneRouterError with route and validRoutes", () => {
    expect(typeof core.GwenSceneRouterError).toBe("function");
    const menu = defineScene("menu", () => {});
    const game = defineScene("game", () => {});
    const routes: Record<string, { scene: SceneFactory; on?: Record<string, string> }> = {
      menu: { scene: menu },
      game: { scene: game },
    };
    let error: unknown;
    try {
      defineSceneRouter({ initial: "mnu", routes });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(core.GwenSceneRouterError);
    if (!(error instanceof core.GwenSceneRouterError)) return;
    expect(error.code).toBe("CORE:INVALID_SCENE_ROUTE");
    expect(error.route).toBe("mnu");
    expect(error.validRoutes).toEqual(["menu", "game"]);
    expect(Object.isFrozen(error.validRoutes)).toBe(true);
    expect(error.from).toBeUndefined();
    expect(error.event).toBeUndefined();
    const what = `Initial state "mnu" is not found in routes.`;
    const fix = __GWEN_DEV__ ? `\nFix: Valid states: menu, game.` : "";
    expect(error.message).toBe(
      `[defineSceneRouter()] ${what}${fix}\nSee https://gwenjs.github.io/gwen/api/errors#core-invalid-scene-route (CORE:INVALID_SCENE_ROUTE)`,
    );
  });

  it("an unknown transition target names from and event", () => {
    expect(typeof core.GwenSceneRouterError).toBe("function");
    const menu = defineScene("menu", () => {});
    const game = defineScene("game", () => {});
    const routes: Record<string, { scene: SceneFactory; on?: Record<string, string> }> = {
      menu: { scene: menu, on: { PLAY: "gmae" } },
      game: { scene: game },
    };
    let error: unknown;
    try {
      defineSceneRouter({ initial: "menu", routes });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(core.GwenSceneRouterError);
    if (!(error instanceof core.GwenSceneRouterError)) return;
    expect(error.code).toBe("CORE:INVALID_SCENE_ROUTE");
    expect(error.route).toBe("gmae");
    expect(error.from).toBe("menu");
    expect(error.event).toBe("PLAY");
    expect(error.validRoutes).toEqual(["menu", "game"]);
    const what = `Transition "PLAY" in state "menu" points to "gmae", which is not a valid route.`;
    const fix = __GWEN_DEV__ ? `\nFix: Valid states: menu, game.` : "";
    expect(error.message).toBe(
      `[defineSceneRouter()] ${what}${fix}\nSee https://gwenjs.github.io/gwen/api/errors#core-invalid-scene-route (CORE:INVALID_SCENE_ROUTE)`,
    );
  });

  it("valid routes build", () => {
    expect(typeof core.GwenSceneRouterError).toBe("function");
    const scene = defineScene("s", () => {});
    const zero = defineSceneRouter({
      initial: "only",
      routes: { only: { scene } },
    });
    expect(zero.__type).toBe("SceneRouterDefinition");
    const one = defineSceneRouter({
      initial: "a",
      routes: {
        a: { scene, on: { GO: "b" } },
        b: { scene },
      },
    });
    expect(one.__type).toBe("SceneRouterDefinition");
    const max = defineSceneRouter({
      initial: "a",
      routes: {
        a: { scene, on: { TO_B: "b", TO_C: "c" } },
        b: { scene, on: { TO_A: "a", TO_C: "c" } },
        c: { scene, on: { TO_A: "a", TO_B: "b" } },
      },
    });
    expect(max.__type).toBe("SceneRouterDefinition");
  });
});

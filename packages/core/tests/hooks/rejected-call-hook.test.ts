import { describe, expect, it } from "vitest";

import { createEngine, CoreErrorCodes, emit } from "../../src/index.js";
import { defineScene } from "../../src/scene/runtime/define-scene.js";
import { defineSceneRouter } from "../../src/router/defines/define-scene-router.js";
import { useSceneRouter } from "../../src/router/uses/use-scene-router.js";
import type { GwenErrorPayload } from "@gwenjs/schema";

declare module "@gwenjs/schema" {
  interface GwenRuntimeHooks {
    "reject-hook:ping": () => void;
  }
}

function trackRejections(): { unhandled: unknown[]; stop: () => void } {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown): void => {
    unhandled.push(reason);
  };
  process.on("unhandledRejection", onUnhandled);
  return {
    unhandled,
    stop: () => {
      process.off("unhandledRejection", onUnhandled);
    },
  };
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

describe("rejected callHook sites", () => {
  it("puts a rejected scene:leave on the error bus during a route change", async () => {
    const tracked = trackRejections();
    const engine = await createEngine();
    const events: GwenErrorPayload[] = [];
    engine.errors.on((event) => {
      events.push(event);
    });
    const menu = defineScene("LeaveMenu", () => {});
    const game = defineScene("LeaveGame", () => {});
    const router = defineSceneRouter({
      initial: "menu",
      routes: {
        menu: { scene: menu, on: { PLAY: "game" } },
        game: { scene: game, on: {} },
      },
    });
    engine.hooks.hook("scene:leave", () => Promise.reject(new Error("scene leave failed")));

    try {
      await engine.run(async () => {
        await useSceneRouter(router).send("PLAY");
      });
      await flush();
      const hit = events.find((event) => event.message === "scene leave failed");
      expect(hit).toMatchObject({
        level: "error",
        code: CoreErrorCodes.PLUGIN_RUNTIME_ERROR,
        source: "scene:LeaveMenu",
        context: { hook: "scene:leave" },
      });
      // A rejected callHook does not say which listener failed: no target, no isolation.
      expect(hit?.target).toBeUndefined();
      expect(engine.isolated()).toEqual([]);
      expect(tracked.unhandled).toEqual([]);
    } finally {
      tracked.stop();
      await engine.stop();
    }
  });

  it("puts a rejected scene:leave on the error bus when an overlay closes", async () => {
    const tracked = trackRejections();
    const engine = await createEngine();
    const events: GwenErrorPayload[] = [];
    engine.errors.on((event) => {
      events.push(event);
    });
    const game = defineScene("OverlayGame", () => {});
    const pause = defineScene("OverlayPause", () => {});
    const router = defineSceneRouter({
      initial: "game",
      routes: {
        game: { scene: game, on: { PAUSE: "pause" } },
        pause: { scene: pause, overlay: true, on: { RESUME: "game" } },
      },
    });
    engine.hooks.hook("scene:leave", () => Promise.reject(new Error("overlay leave failed")));

    try {
      await engine.run(async () => {
        const nav = useSceneRouter(router);
        await nav.send("PAUSE");
        await nav.send("RESUME");
      });
      await flush();
      const hit = events.find((event) => event.message === "overlay leave failed");
      expect(hit).toMatchObject({
        level: "error",
        code: CoreErrorCodes.PLUGIN_RUNTIME_ERROR,
        source: "scene:OverlayPause",
        context: { hook: "scene:leave" },
      });
      // A rejected callHook does not say which listener failed: no target, no isolation.
      expect(hit?.target).toBeUndefined();
      expect(engine.isolated()).toEqual([]);
      expect(tracked.unhandled).toEqual([]);
    } finally {
      tracked.stop();
      await engine.stop();
    }
  });

  it("puts a rejected emit handler on the error bus", async () => {
    const tracked = trackRejections();
    const engine = await createEngine();
    const events: GwenErrorPayload[] = [];
    engine.errors.on((event) => {
      events.push(event);
    });
    engine.hooks.hook("reject-hook:ping", () => Promise.reject(new Error("emit hook failed")));

    try {
      engine.run(() => {
        emit("reject-hook:ping");
      });
      await flush();
      const hit = events.find((event) => event.message === "emit hook failed");
      expect(hit).toMatchObject({
        level: "error",
        code: CoreErrorCodes.PLUGIN_RUNTIME_ERROR,
        source: "emit",
        context: { hook: "reject-hook:ping" },
      });
      expect(hit?.target).toBeUndefined();
      expect(engine.isolated()).toEqual([]);
      expect(tracked.unhandled).toEqual([]);
    } finally {
      tracked.stop();
      await engine.stop();
    }
  });
});

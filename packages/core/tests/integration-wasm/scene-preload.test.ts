import { describe, expect, it } from "vitest";
import { GwenScenePreloadError } from "../../src/scene/scene-preload-error.js";
import { defineSceneRouter, useSceneRouter } from "../../src/router/index.js";
import { defineScene } from "../../src/scene/runtime/define-scene.js";
import { onEnter, onExit, onPreload } from "../../src/scene/runtime/scene-context.js";
import { createRealEngine } from "./harness.js";

describe("scene preload", () => {
  it("entities spawned by the current scene survive a failed preload", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 64, scenes: true });
    const { engine, bridge } = handle;
    try {
      const spawned: { index: number; generation: number }[] = [];
      const boom = new Error("boom");
      const SceneA = defineScene("A", () => {
        onEnter(() => {
          for (let index = 0; index < 10; index += 1) {
            const created = bridge.createEntity();
            spawned.push({ index: created.index, generation: created.generation });
          }
        });
        onExit(() => {
          // WasmBridge has deleteEntity, not destroyEntity (wasm-bridge-types.ts).
          for (const id of spawned) bridge.deleteEntity(id.index, id.generation);
          spawned.length = 0;
        });
      });
      const SceneB = defineScene("B", () => {
        onPreload(() => {
          throw boom;
        });
      });
      const router = defineSceneRouter({
        initial: "a",
        routes: {
          a: { scene: SceneA, on: { B: "b" } },
          b: { scene: SceneB, on: {} },
        },
      });
      const nav = engine.run(() => useSceneRouter(router));
      // Creating the router does not run onEnter. The bootstrap fires scene:enter.
      await engine.hooks.callHook("scene:enter", "A");
      expect(bridge.countEntities()).toBe(10);
      let caught: unknown;
      try {
        await nav.send("B");
        caught = undefined;
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(GwenScenePreloadError);
      expect(bridge.countEntities()).toBe(10);
      expect(nav.current).toBe("a");
    } finally {
      await handle.dispose();
    }
  });
});

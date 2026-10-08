import { describe, expect, it } from "vitest";
import { CoreErrorCodes } from "@gwenjs/core";
import { createRealEngine } from "@gwenjs/core/testing";
import type { GwenErrorPayload } from "@gwenjs/schema";
import { Physics3DPlugin } from "../src/plugin/index";

describe("physics3d rejected collision hook", () => {
  it("puts a rejected physics3d:collision handler on the error bus", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    const { engine, advance } = await createRealEngine({
      variant: "physics3d",
      maxEntities: 64,
    });
    const events: GwenErrorPayload[] = [];
    engine.errors.on((event) => {
      events.push(event);
    });

    try {
      await engine.use(Physics3DPlugin({ gravity: { x: 0, y: 0, z: 0 } }));
      engine.hooks.hook("physics3d:collision", () =>
        Promise.reject(new Error("physics3d collision hook failed")),
      );
      const physics = engine.inject("physics3d");
      const left = engine.createEntity();
      const right = engine.createEntity();
      physics.createBody(left, { kind: "dynamic", initialPosition: { x: 0, y: 0, z: 0 } });
      physics.addCollider(left, { shape: { type: "box", halfX: 0.5, halfY: 0.5, halfZ: 0.5 } });
      physics.createBody(right, { kind: "dynamic", initialPosition: { x: 0.2, y: 0, z: 0 } });
      physics.addCollider(right, { shape: { type: "box", halfX: 0.5, halfY: 0.5, halfZ: 0.5 } });

      await advance(5, 1 / 60);
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });

      const hit = events.find((event) => event.message === "physics3d collision hook failed");
      expect(hit).toMatchObject({
        level: "error",
        code: CoreErrorCodes.PLUGIN_RUNTIME_ERROR,
        source: "@gwenjs/physics3d",
        context: { hook: "physics3d:collision" },
      });
      // A rejected callHook does not say which listener failed: no target, no isolation.
      expect(hit?.target).toBeUndefined();
      expect(engine.isolated()).toEqual([]);
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
      await engine.stop();
    }
  });
});

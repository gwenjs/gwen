import { describe, expect, it } from "vitest";

import type { GwenErrorPayload } from "@gwenjs/schema";
import { CoreErrorCodes, type EngineErrorPayload } from "../../src/index.js";
import { createRealEngine } from "./harness.js";
import "../../../physics3d/src/augment";
import { Physics3DPlugin } from "../../../physics3d/src/plugin/index";
import type { Physics3DAPI } from "../../../physics3d/src/types";
import type { Physics2DAPI } from "../../../physics2d/src/types";
import "../../../physics2d/src/augment";
import { Physics2DPlugin } from "../../../physics2d/src/plugin/index";

declare module "../../src/engine/gwen-engine.js" {
  interface GwenProvides {
    physics2d: Physics2DAPI;
    physics3d: Physics3DAPI;
  }
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

describe("a rejected physics listener does not stop the physics plugin", () => {
  it("physics3d: a rejecting physics3d:collision listener isolates nothing and bodies keep falling", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    const handle = await createRealEngine({ variant: "physics3d", maxEntities: 64 });
    try {
      const { engine, advance } = handle;
      await engine.use(Physics3DPlugin({ gravity: { x: 0, y: -10, z: 0 } }));
      process.on("unhandledRejection", onUnhandled);
      const events: GwenErrorPayload[] = [];
      engine.errors.on((event) => {
        events.push(event);
      });
      let rejected = 0;
      engine.hooks.hook("physics3d:collision", () => {
        rejected += 1;
        return Promise.reject(new Error("collision listener failed"));
      });
      const physics = engine.inject("physics3d");
      const box = { shape: { type: "box" as const, halfX: 0.5, halfY: 0.5, halfZ: 0.5 } };
      const left = engine.createEntity();
      const right = engine.createEntity();
      physics.createBody(left, { kind: "dynamic", initialPosition: { x: 0, y: 100, z: 0 } });
      physics.addCollider(left, box);
      physics.createBody(right, { kind: "dynamic", initialPosition: { x: 0.2, y: 100, z: 0 } });
      physics.addCollider(right, box);
      const faller = engine.createEntity();
      physics.createBody(faller, { kind: "dynamic", initialPosition: { x: 50, y: 100, z: 0 } });

      await advance(5, 1 / 60);
      await flush();
      expect(rejected).toBeGreaterThan(0);
      const yAfterReject = physics.getBodyState(faller)?.position.y;
      if (yAfterReject === undefined) throw new Error("expected a physics3d body state");

      await advance(30, 1 / 60);

      const yLater = physics.getBodyState(faller)?.position.y;
      if (yLater === undefined) throw new Error("expected a physics3d body state");
      expect(yLater).toBeLessThan(yAfterReject - 0.5);
      expect(engine.isolated()).toEqual([]);

      await flush();
      const failures = events.filter((event) => event.message === "collision listener failed");
      // One event per rejected callHook, and no other error on the bus.
      expect(failures.length).toBeGreaterThan(0);
      expect(failures).toHaveLength(rejected);
      expect(events).toHaveLength(failures.length);
      for (const failure of failures) {
        expect(failure).toMatchObject({
          level: "error",
          code: CoreErrorCodes.PLUGIN_RUNTIME_ERROR,
          source: "@gwenjs/physics3d",
          context: { hook: "physics3d:collision" },
        });
        expect(failure.target).toBeUndefined();
      }
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
      await handle.dispose();
    }
  });

  it("physics2d: a rejecting physics:collision listener isolates nothing and bodies keep falling", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    const handle = await createRealEngine({ variant: "physics2d", maxEntities: 64 });
    try {
      const { engine, advance } = handle;
      await engine.use(Physics2DPlugin({ gravity: -10 }));
      process.on("unhandledRejection", onUnhandled);
      const events: GwenErrorPayload[] = [];
      engine.errors.on((event) => {
        events.push(event);
      });
      let rejected = 0;
      engine.hooks.hook("physics:collision", () => {
        rejected += 1;
        return Promise.reject(new Error("collision listener failed"));
      });
      const physics = engine.inject("physics2d");
      const left = engine.createEntity();
      const right = engine.createEntity();
      physics.addBoxCollider(physics.addRigidBody(left, "dynamic", 0, 100), 0.5, 0.5);
      physics.addBoxCollider(physics.addRigidBody(right, "dynamic", 0.2, 100), 0.5, 0.5);
      const faller = engine.createEntity();
      physics.addRigidBody(faller, "dynamic", 50, 100);

      await advance(5, 1 / 60);
      await flush();
      expect(rejected).toBeGreaterThan(0);
      const yAfterReject = physics.getPosition(faller)?.y;
      if (yAfterReject === undefined) throw new Error("expected a physics2d body position");

      await advance(30, 1 / 60);

      const yLater = physics.getPosition(faller)?.y;
      if (yLater === undefined) throw new Error("expected a physics2d body position");
      expect(yLater).toBeLessThan(yAfterReject - 0.5);
      expect(engine.isolated()).toEqual([]);

      await flush();
      const failures = events.filter((event) => event.message === "collision listener failed");
      // One event per rejected callHook, and no other error on the bus.
      expect(failures.length).toBeGreaterThan(0);
      expect(failures).toHaveLength(rejected);
      expect(events).toHaveLength(failures.length);
      for (const failure of failures) {
        expect(failure).toMatchObject({
          level: "error",
          code: CoreErrorCodes.PLUGIN_RUNTIME_ERROR,
          source: "@gwenjs/physics2d",
          context: { hook: "physics:collision" },
        });
        expect(failure.target).toBeUndefined();
      }
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
      await handle.dispose();
    }
  });
});

describe("a rejected physics2d hook is published without a target", () => {
  it("physics:sensor:changed: a rejecting listener gives an error with no target and isolates nothing", async () => {
    const handle = await createRealEngine({ variant: "physics2d", maxEntities: 64 });
    try {
      const { engine, advance } = handle;
      await engine.use(Physics2DPlugin({ gravity: 0 }));
      const events: EngineErrorPayload[] = [];
      engine.hooks.hook("engine:error", (payload) => {
        events.push(payload);
      });
      let rejected = 0;
      engine.hooks.hook("physics:sensor:changed", () => {
        rejected += 1;
        return Promise.reject(new Error("sensor listener failed"));
      });
      const physics = engine.inject("physics2d");
      const sensor = engine.createEntity();
      await engine.hooks.callHook("prefab:instantiate", sensor, {
        physics: {
          bodyType: "dynamic",
          gravityScale: 0,
          colliders: [{ shape: "box", hw: 16, hh: 16, isSensor: true, colliderId: 0 }],
        },
      });
      const visitor = engine.createEntity();
      physics.addBoxCollider(physics.addRigidBody(visitor, "dynamic", 0, 0), 0.5, 0.5);

      await advance(5, 1 / 60);
      await flush();

      expect(rejected).toBeGreaterThan(0);
      const failure = events.find((event) => event.message === "sensor listener failed");
      expect(failure).toMatchObject({ level: "error", source: "@gwenjs/physics2d" });
      expect(failure?.target).toBeUndefined();
      expect(engine.isolated()).toEqual([]);
    } finally {
      await handle.dispose();
    }
  });

  it("physics:collision:batch (hybrid): a rejecting listener gives an error with no target and isolates nothing", async () => {
    const handle = await createRealEngine({ variant: "physics2d", maxEntities: 64 });
    try {
      const { engine, advance } = handle;
      await engine.use(Physics2DPlugin({ gravity: 0, eventMode: "hybrid" }));
      const events: EngineErrorPayload[] = [];
      engine.hooks.hook("engine:error", (payload) => {
        events.push(payload);
      });
      let rejected = 0;
      engine.hooks.hook("physics:collision:batch", () => {
        rejected += 1;
        return Promise.reject(new Error("batch listener failed"));
      });
      const physics = engine.inject("physics2d");
      const left = engine.createEntity();
      const right = engine.createEntity();
      physics.addBoxCollider(physics.addRigidBody(left, "dynamic", 0, 0), 0.5, 0.5);
      physics.addBoxCollider(physics.addRigidBody(right, "dynamic", 0.2, 0), 0.5, 0.5);

      await advance(5, 1 / 60);
      await flush();

      expect(rejected).toBeGreaterThan(0);
      const failure = events.find((event) => event.message === "batch listener failed");
      expect(failure).toMatchObject({ level: "error", source: "@gwenjs/physics2d" });
      expect(failure?.target).toBeUndefined();
      expect(engine.isolated()).toEqual([]);
    } finally {
      await handle.dispose();
    }
  });
});

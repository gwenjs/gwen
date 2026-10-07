import { describe, expect, it } from "vitest";

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
    const handle = await createRealEngine({ variant: "physics3d", maxEntities: 64 });
    try {
      const { engine, advance } = handle;
      await engine.use(Physics3DPlugin({ gravity: { x: 0, y: -10, z: 0 } }));
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
    } finally {
      await handle.dispose();
    }
  });

  it("physics2d: a rejecting physics:collision listener isolates nothing and bodies keep falling", async () => {
    const handle = await createRealEngine({ variant: "physics2d", maxEntities: 64 });
    try {
      const { engine, advance } = handle;
      await engine.use(Physics2DPlugin({ gravity: -10 }));
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
    } finally {
      await handle.dispose();
    }
  });
});

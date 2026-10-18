/**
 * A dynamic body created with no damping option keeps the velocity it was given.
 * The 2D page must state that typed default.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { createRealEngine, type RealEngineHandle } from "./harness.js";
import "../../../physics2d/src/augment";
import { Physics2DPlugin } from "../../../physics2d/src/plugin/index";
import type { Physics2DAPI } from "../../../physics2d/src/types";

declare module "../../src/engine/engine-types.js" {
  interface GwenProvides {
    physics2d: Physics2DAPI;
  }
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

async function openPhysics(handle: RealEngineHandle): Promise<Physics2DAPI> {
  await handle.engine.use(Physics2DPlugin({ gravity: 0, maxEntities: 32 }));
  return handle.engine.inject("physics2d");
}

describe("2D damping default", () => {
  it("keeps the launch speed of two bodies created with no damping option", async () => {
    const handle = await createRealEngine({ variant: "physics2d", maxEntities: 32, physicsHz: 60 });
    try {
      const physics = await openPhysics(handle);
      const { engine, advance } = handle;
      const resting = engine.createEntity();
      const forward = engine.createEntity();
      const backward = engine.createEntity();
      physics.addRigidBody(resting, "dynamic", 0, 0, {
        gravityScale: 0,
        mass: 1,
        initialVelocity: { vx: 0, vy: 0 },
      });
      physics.addRigidBody(forward, "dynamic", 4, 0, {
        gravityScale: 0,
        mass: 1,
        initialVelocity: { vx: 10, vy: 0 },
      });
      physics.addRigidBody(backward, "dynamic", 8, 0, {
        gravityScale: 0,
        mass: 1,
        initialVelocity: { vx: -4, vy: 0 },
      });
      await advance(1, 1 / 60);
      await advance(1, 1 / 60);
      const stopped = physics.getLinearVelocity(resting);
      const ahead = physics.getLinearVelocity(forward);
      const behind = physics.getLinearVelocity(backward);
      expect(stopped).toEqual({ x: 0, y: 0 });
      expect(ahead?.x).toBeCloseTo(10, 3);
      expect(ahead?.y).toBeCloseTo(0, 3);
      expect(behind?.x).toBeCloseTo(-4, 3);
      expect(behind?.y).toBeCloseTo(0, 3);

      const page = readFileSync(
        path.join(repoRoot, "docs/physics/physics2d-composables.md"),
        "utf8",
      );
      expect(page).toContain("Linear velocity damping (default: 0)\n");
      expect(page).toContain("Angular velocity damping (default: 0)\n");
      expect(page).not.toContain("(default: 0.1)");
      expect(page).not.toContain("not yet supported");
    } finally {
      await handle.dispose();
    }
  });
});

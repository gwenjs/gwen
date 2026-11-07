/**
 * Named layer and mask on a real physics2d engine.
 * An excluded mask produces no contact. An included mask does.
 */
import { describe, expect, it } from "vitest";
import { GwenError } from "@gwenjs/schema";
import { createRealEngine } from "./harness.js";
import "../../../physics2d/src/augment";
import { Physics2DPlugin } from "../../../physics2d/src/plugin/index";
import type { Physics2DAPI } from "../../../physics2d/src/types";

declare module "@gwenjs/schema" {
  interface GwenProvides {
    physics2d: Physics2DAPI;
  }
}

const LAYER_HINT = "Add it to Physics2DConfig.layers or fix the typo.";

async function startedContacts(includeOther: boolean): Promise<number> {
  const handle = await createRealEngine({ variant: "physics2d", maxEntities: 32 });
  try {
    const { engine, advance } = handle;
    await engine.use(
      Physics2DPlugin({
        gravity: { x: 0, y: 0 },
        layers: { solid: 0, ghost: 1 },
      }),
    );
    let started = 0;
    engine.hooks.hook("physics:collision", (contacts) => {
      for (const contact of contacts) {
        if (contact.started) started += 1;
      }
    });
    const physics = engine.inject("physics2d");
    const left = engine.createEntity();
    const right = engine.createEntity();
    const leftMask = includeOther ? ["solid", "ghost"] : ["solid"];
    const rightMask = includeOther ? ["solid", "ghost"] : ["ghost"];
    physics.addBoxCollider(physics.addRigidBody(left, "dynamic", 0, 0), 0.5, 0.5, {
      layer: "solid",
      mask: leftMask,
    });
    physics.addBoxCollider(physics.addRigidBody(right, "dynamic", 0.2, 0), 0.5, 0.5, {
      layer: "ghost",
      mask: rightMask,
    });
    await advance(5, 1 / 60);
    return started;
  } finally {
    await handle.dispose();
  }
}

describe("physics2d layers on a real engine", () => {
  it("an excluded mask produces no contact and an included mask does", async () => {
    expect(await startedContacts(false)).toBe(0);
    expect(await startedContacts(true)).toBeGreaterThan(0);
  });

  it("an unknown layer throws PHYSICS2D:UNKNOWN_LAYER", async () => {
    const handle = await createRealEngine({ variant: "physics2d", maxEntities: 32 });
    try {
      const { engine } = handle;
      await engine.use(
        Physics2DPlugin({
          gravity: { x: 0, y: 0 },
          layers: { solid: 0 },
        }),
      );
      const physics = engine.inject("physics2d");
      const id = engine.createEntity();
      const body = physics.addRigidBody(id, "dynamic", 0, 0);
      let caught: unknown;
      try {
        physics.addBoxCollider(body, 0.5, 0.5, { layer: "missing" });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(GwenError);
      if (!(caught instanceof GwenError)) return;
      expect(caught.code).toBe("PHYSICS2D:UNKNOWN_LAYER");
      expect(caught.message).toContain(
        'Unknown layer "missing" in layer. Declared layers: [solid].',
      );
      expect(caught.hint).toBe(__GWEN_DEV__ ? LAYER_HINT : undefined);
    } finally {
      await handle.dispose();
    }
  });
});

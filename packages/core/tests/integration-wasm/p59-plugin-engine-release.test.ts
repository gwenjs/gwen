/**
 * A physics plugin object installed on an engine must not keep that engine
 * alive after the engine is disposed (#59: no strong per-plugin engine cache).
 */
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { createRealEngine } from "./harness.js";
import "../../../physics2d/src/augment";
import { Physics2DPlugin } from "../../../physics2d/src/plugin/index";
import "../../../physics3d/src/augment";
import { Physics3DPlugin } from "../../../physics3d/src/plugin/index";
import type { Physics2DAPI } from "../../../physics2d/src/types";
import type { Physics3DAPI } from "../../../physics3d/src/types";

declare module "../../src/engine/gwen-engine.js" {
  interface GwenProvides {
    physics2d: Physics2DAPI;
    physics3d: Physics3DAPI;
  }
}

setFlagsFromString("--expose-gc");
const collect: unknown = runInNewContext("gc");

async function collectGarbage(): Promise<void> {
  if (typeof collect !== "function") throw new Error("gc is not available");
  for (let round = 0; round < 6; round += 1) {
    collect();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe("physics plugins release a disposed engine", () => {
  it("does not keep a disposed 2d engine alive", async () => {
    const plugin = Physics2DPlugin({ gravity: 0 });
    const ref = await (async () => {
      const handle = await createRealEngine({ variant: "physics2d", maxEntities: 8 });
      try {
        await handle.engine.use(plugin);
        const physics = handle.engine.inject("physics2d");
        physics.addRigidBody(handle.engine.createEntity(), "dynamic", 0, 0);
        await handle.advance(1, 1 / 60);
        return new WeakRef(handle.engine);
      } finally {
        await handle.dispose();
      }
    })();
    await collectGarbage();
    expect(ref.deref()).toBeUndefined();
    expect(plugin.name).toBeTypeOf("string");
  });

  it("does not keep a disposed 3d engine alive", async () => {
    const plugin = Physics3DPlugin({ gravity: { x: 0, y: 0, z: 0 } });
    const ref = await (async () => {
      const handle = await createRealEngine({ variant: "physics3d", maxEntities: 8 });
      try {
        await handle.engine.use(plugin);
        const physics = handle.engine.inject("physics3d");
        physics.createBody(handle.engine.createEntity(), {
          kind: "dynamic",
          initialPosition: { x: 0, y: 0, z: 0 },
        });
        await handle.advance(1, 1 / 60);
        return new WeakRef(handle.engine);
      } finally {
        await handle.dispose();
      }
    })();
    await collectGarbage();
    expect(ref.deref()).toBeUndefined();
    expect(plugin.name).toBeTypeOf("string");
  });
});

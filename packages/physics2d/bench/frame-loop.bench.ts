import { bench } from "vitest";

import {
  FRAME_LOOP_BOX_HALF,
  FRAME_LOOP_MAX_ENTITIES,
  createEntityId,
  measureFrameLoop,
  type FrameScene,
} from "../../core/bench/frame-loop-scene.js";
import type { RealEngineHandle } from "../../core/tests/integration-wasm/harness.js";
import "../src/augment.js";
import { Physics2DPlugin } from "../src/index.js";

async function installPhysics(
  handle: RealEngineHandle,
  scene: FrameScene,
): Promise<readonly string[]> {
  const plugin = Physics2DPlugin({
    maxEntities: FRAME_LOOP_MAX_ENTITIES,
    gravity: -9.81,
  });
  await handle.engine.use(plugin);
  const physics = handle.engine.inject("physics2d");
  for (let index = 0; index < scene.n; index += 1) {
    const slot = scene.slots[index] ?? 0;
    const id = createEntityId(slot, handle.bridge.getEntityGeneration(slot));
    const body = physics.addRigidBody(id, "dynamic", scene.xs[index] ?? 0, scene.ys[index] ?? 0);
    physics.addBoxCollider(body, FRAME_LOOP_BOX_HALF, FRAME_LOOP_BOX_HALF);
  }
  return [plugin.name];
}

bench(
  "physics2d reference scene",
  () => measureFrameLoop({ variant: "physics2d", install: installPhysics }),
  { iterations: 1, warmupIterations: 0, warmupTime: 0, time: 0 },
);

/**
 * Physics step on the real physics2d and physics3d WASM binaries.
 *
 * Run:
 *   pnpm --filter @gwenjs/core exec vitest bench --run bench/physics-step-wasm.bench.ts
 */

import { bench, describe } from "vitest";

import {
  buildScene,
  stepScene,
  WARMUP_STEPS,
  type PhysicsScene,
} from "./fixtures/physics-step-scene";

function register(variant: "physics2d" | "physics3d", count: number): void {
  let scene: PhysicsScene | undefined;
  bench(
    `${variant} N=${count}`,
    () => {
      if (!scene) throw new Error("scene was not built");
      stepScene(scene);
    },
    {
      async setup() {
        if (scene) return;
        scene = await buildScene(variant, count);
        for (let step = 0; step < WARMUP_STEPS; step += 1) stepScene(scene);
      },
      teardown(_task, mode) {
        if (mode !== "run") return;
        scene?.free();
        scene = undefined;
      },
    },
  );
}

describe("physics step (real WASM)", () => {
  register("physics2d", 500);
  register("physics2d", 2000);
  register("physics3d", 500);
  register("physics3d", 2000);
});

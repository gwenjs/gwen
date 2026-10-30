/**
 * Red stub. Same exports as the real fixture. Loads both factories and adds no bodies.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createGlue as createPhysics2d } from "../../wasm/physics2d/gwen_core_factory.js";
import { createGlue as createPhysics3d } from "../../wasm/physics3d/gwen_core_factory.js";

export const WARMUP_STEPS = 120;
export const STEP_DT = 1 / 60;

type Engine2d = InstanceType<ReturnType<typeof createPhysics2d>["Engine"]>;
type Engine3d = InstanceType<ReturnType<typeof createPhysics3d>["Engine"]>;

export interface Scene2d {
  readonly variant: "physics2d";
  readonly engine: Engine2d;
  readonly firstDynamicSlot: number;
  readonly sampleSlots: readonly number[];
  free(): void;
}

export interface Scene3d {
  readonly variant: "physics3d";
  readonly engine: Engine3d;
  readonly firstDynamicSlot: number;
  readonly sampleSlots: readonly number[];
  free(): void;
}

export type PhysicsScene = Scene2d | Scene3d;

function wasmBytes(variant: "physics2d" | "physics3d"): Buffer {
  const wasmPath = fileURLToPath(
    new URL(`../../wasm/${variant}/gwen_core_bg.wasm`, import.meta.url),
  );
  return readFileSync(wasmPath);
}

function build2d(): Scene2d {
  const glue = createPhysics2d();
  glue.initSync({ module: wasmBytes("physics2d") });
  const engine = new glue.Engine(1);
  engine.physics_init(0, -9.81, 1);
  return {
    variant: "physics2d",
    engine,
    firstDynamicSlot: 0,
    sampleSlots: [0],
    free() {
      engine.free();
    },
  };
}

function build3d(): Scene3d {
  const glue = createPhysics3d();
  glue.initSync({ module: wasmBytes("physics3d") });
  const engine = new glue.Engine(1);
  engine.physics3d_init(0, -9.81, 0, 1);
  return {
    variant: "physics3d",
    engine,
    firstDynamicSlot: 0,
    sampleSlots: [0],
    free() {
      engine.free();
    },
  };
}

export async function buildScene(variant: string, count: number): Promise<PhysicsScene> {
  void count;
  if (variant === "physics3d") return build3d();
  return build2d();
}

export function stepScene(scene: PhysicsScene): void {
  void scene;
}

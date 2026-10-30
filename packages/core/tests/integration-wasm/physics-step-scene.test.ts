import { readFileSync } from "node:fs";

import { expect, it } from "vitest";

import {
  buildScene,
  stepScene,
  WARMUP_STEPS,
  type PhysicsScene,
} from "../../bench/fixtures/physics-step-scene";

const COUNTS = [500, 2000] as const;
const MOTION_STEPS = 10;
const MOTION_EPSILON = 1e-3;

function sampleCoordinates(scene: PhysicsScene): number[] {
  const coordinates: number[] = [];
  for (const slot of scene.sampleSlots) {
    if (scene.variant === "physics2d") {
      const position = scene.engine.physics_get_position(slot);
      coordinates.push(position[0] ?? 0, position[1] ?? 0);
    } else {
      const state = scene.engine.physics3d_get_body_state(slot);
      coordinates.push(state[0] ?? 0, state[1] ?? 0, state[2] ?? 0);
    }
  }
  return coordinates;
}

function motionAfterWarmup(scene: PhysicsScene): number {
  for (let step = 0; step < WARMUP_STEPS; step += 1) stepScene(scene);
  const before = sampleCoordinates(scene);
  for (let step = 0; step < MOTION_STEPS; step += 1) stepScene(scene);
  const after = sampleCoordinates(scene);
  let moved = 0;
  for (let index = 0; index < before.length; index += 1) {
    moved += Math.abs((after[index] ?? 0) - (before[index] ?? 0));
  }
  return moved;
}

function yOf(scene: PhysicsScene): number {
  if (scene.variant === "physics2d") {
    return scene.engine.physics_get_position(scene.firstDynamicSlot)[1] ?? Number.NaN;
  }
  return scene.engine.physics3d_get_body_state(scene.firstDynamicSlot)[1] ?? Number.NaN;
}

async function sceneSteps(variant: "physics2d" | "physics3d"): Promise<void> {
  for (const count of COUNTS) {
    const scene = await buildScene(variant, count);
    try {
      expect(scene.engine.count_entities()).toBe(count);
      const before = yOf(scene);
      for (let step = 0; step < 10; step += 1) stepScene(scene);
      expect(scene.engine.count_entities()).toBe(count);
      expect(yOf(scene)).not.toBe(before);
    } finally {
      scene.free();
    }
    const second = await buildScene(variant, count);
    try {
      expect(second.engine.count_entities()).toBe(count);
    } finally {
      second.free();
    }
    const left = await buildScene(variant, count);
    let right: PhysicsScene | undefined;
    try {
      right = await buildScene(variant, count);
      expect(left.engine).not.toBe(right.engine);
      expect(left.engine.count_entities()).toBe(count);
      expect(right.engine.count_entities()).toBe(count);
      for (let step = 0; step < 10; step += 1) {
        stepScene(left);
        stepScene(right);
      }
      expect(left.engine.count_entities()).toBe(count);
      expect(right.engine.count_entities()).toBe(count);
    } finally {
      left.free();
      right?.free();
    }
  }
}

it("physics2d scene steps N bodies", async () => {
  await sceneSteps("physics2d");
}, 30_000);

it("physics3d scene steps N bodies", async () => {
  await sceneSteps("physics3d");
}, 120_000);

it("physics2d scene is still active after the warm-up", async () => {
  for (const count of COUNTS) {
    const scene = await buildScene("physics2d", count);
    try {
      expect(scene.engine.count_entities()).toBe(count);
      expect(motionAfterWarmup(scene)).toBeGreaterThan(MOTION_EPSILON);
    } finally {
      scene.free();
    }
  }
}, 20_000);

it("physics3d scene is still active after the warm-up", async () => {
  for (const count of COUNTS) {
    const scene = await buildScene("physics3d", count);
    try {
      expect(scene.engine.count_entities()).toBe(count);
      expect(motionAfterWarmup(scene)).toBeGreaterThan(MOTION_EPSILON);
    } finally {
      scene.free();
    }
  }
}, 120_000);

it("buildScene rejects an unknown variant", async () => {
  await expect(buildScene("nope", 1)).rejects.toThrow("unknown variant: nope");
});

function staticFactoryImports(source: string): string[] {
  const withoutBlock = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const found: string[] = [];
  for (const line of withoutBlock.split("\n")) {
    const code = line.replace(/\/\/.*$/, "");
    if (/^\s*import\s/.test(code) && code.includes("gwen_core_factory")) found.push(code.trim());
  }
  return found;
}

it("physics bench load does not import the other variant factory", () => {
  const fixture = readFileSync(
    new URL("../../bench/fixtures/physics-step-scene.ts", import.meta.url),
    "utf8",
  );
  const bench = readFileSync(
    new URL("../../bench/physics-step-wasm.bench.ts", import.meta.url),
    "utf8",
  );
  expect(staticFactoryImports(fixture)).toEqual([]);
  expect(staticFactoryImports(bench)).toEqual([]);
  expect(fixture.includes("physics2d/gwen_core_factory")).toBe(false);
  expect(fixture.includes("physics3d/gwen_core_factory")).toBe(false);
  const sceneCalls = bench
    .split("\n")
    .filter((line) => line.includes("buildScene(") && !line.trimStart().startsWith("//"));
  expect(sceneCalls.length).toBeGreaterThan(0);
  expect(sceneCalls.every((line) => /^\s+scene = await buildScene\(/.test(line))).toBe(true);
});

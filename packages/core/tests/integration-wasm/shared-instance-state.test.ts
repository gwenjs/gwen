/**
 * Two engines on one shared wasm instance do not read each other's path.
 * The three real core binaries export none of the free path or collision buffers.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type {
  WasmEnginePhysics2D,
  WasmEnginePhysics3D,
} from "../../src/engine/wasm-bridge-types.js";
import "../../../physics3d/src/augment";
import { Physics3DPlugin } from "../../../physics3d/src/plugin/index";
import type { PathWaypoint3D, Physics3DAPI } from "../../../physics3d/src/types";
import { createRealEngine, type RealEngineHandle } from "./harness.js";

const VARIANTS = ["light", "physics2d", "physics3d"] as const;
type Variant = (typeof VARIANTS)[number];

const FORBIDDEN = [
  "find_path_2d",
  "get_path_buffer_ptr",
  "get_collision_events_ptr",
  "get_collision_event_count",
  "find_path_3d",
  "get_path_buffer_ptr_3d",
] as const;

const PRIMED_PATH: readonly PathWaypoint3D[] = [
  { x: 1, y: 0, z: 0 },
  { x: 1, y: 0, z: 1 },
  { x: 1, y: 0, z: 2 },
];

function wasmBytes(variant: Variant): Uint8Array<ArrayBuffer> {
  const wasmPath = fileURLToPath(
    new URL(`../../wasm/${variant}/gwen_core_bg.wasm`, import.meta.url),
  );
  const file = readFileSync(wasmPath);
  const bytes = new Uint8Array(file.byteLength);
  bytes.set(file);
  return bytes;
}

function linearMemory(handle: RealEngineHandle): WebAssembly.Memory {
  const memory = handle.bridge.getLinearMemory();
  expect(memory).toBeInstanceOf(WebAssembly.Memory);
  if (!(memory instanceof WebAssembly.Memory)) {
    throw new Error("expected linear memory");
  }
  return memory;
}

function physics2d(handle: RealEngineHandle): WasmEnginePhysics2D {
  const bridge = handle.bridge.getPhysicsBridge();
  if (!("path_find_2d" in bridge)) {
    throw new Error("expected the physics2d bridge");
  }
  return bridge;
}

function physics3d(handle: RealEngineHandle): WasmEnginePhysics3D {
  const bridge = handle.bridge.getPhysicsBridge();
  if (!("physics3d_get_path_buffer_ptr_3d" in bridge)) {
    throw new Error("expected the physics3d bridge");
  }
  return bridge;
}

function readFloats(memory: WebAssembly.Memory, ptr: number, count: number): number[] {
  return Array.from(new Float32Array(memory.buffer, ptr, count));
}

async function startPhysics(handle: RealEngineHandle): Promise<Physics3DAPI> {
  await handle.engine.use(Physics3DPlugin({ gravity: { x: 0, y: -10, z: 0 } }));
  return handle.engine.inject("physics3d");
}

describe("shared instance path buffers", () => {
  it("shared: engine B does not read engine A's 2d path", async () => {
    const handleA = await createRealEngine({ variant: "physics2d", maxEntities: 8 });
    try {
      const handleB = await createRealEngine({ variant: "physics2d", maxEntities: 8 });
      try {
        const memoryA = linearMemory(handleA);
        const memoryB = linearMemory(handleB);
        expect(memoryB).toBe(memoryA);

        const bridgeA = physics2d(handleA);
        const bridgeB = physics2d(handleB);
        expect(bridgeA.path_find_2d(0, 0, 5, 0)).toBe(6);
        const floats = readFloats(memoryB, bridgeB.path_get_result_ptr(), 12);
        expect(floats).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
      } finally {
        await handleB.dispose();
      }
    } finally {
      await handleA.dispose();
    }
  });

  it("shared: engine B does not read engine A's 3d path", async () => {
    const handleA = await createRealEngine({ variant: "physics3d", maxEntities: 8 });
    try {
      const handleB = await createRealEngine({ variant: "physics3d", maxEntities: 8 });
      try {
        const memoryA = linearMemory(handleA);
        const memoryB = linearMemory(handleB);
        expect(memoryB).toBe(memoryA);

        const physicsA = await startPhysics(handleA);
        await startPhysics(handleB);
        physicsA.initNavGrid3D({
          grid: new Uint8Array(9),
          width: 3,
          height: 1,
          depth: 3,
          cellSize: 1,
        });
        const path = physicsA.findPath3D({ x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 2 });
        expect(path).toEqual(PRIMED_PATH);

        const bridgeB = physics3d(handleB);
        const read = bridgeB.physics3d_get_path_buffer_ptr_3d;
        if (read === undefined) {
          throw new Error("expected physics3d_get_path_buffer_ptr_3d");
        }
        const floats = readFloats(memoryB, read.call(bridgeB), path.length * 3);
        expect(floats).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
      } finally {
        await handleB.dispose();
      }
    } finally {
      await handleA.dispose();
    }
  });

  it("the core binaries export no instance-global function", () => {
    const offending: string[] = [];
    for (const variant of VARIANTS) {
      const names = new Set(
        WebAssembly.Module.exports(new WebAssembly.Module(wasmBytes(variant))).map(
          (item) => item.name,
        ),
      );
      for (const name of FORBIDDEN) {
        if (names.has(name)) offending.push(`${variant}:${name}`);
      }
    }
    expect(offending).toEqual([]);
  });
});

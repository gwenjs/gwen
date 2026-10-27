/**
 * Real optimised BVH web-target wasm, the artefact the worker loads
 * (packages/physics3d/src/plugin/bvh-worker.ts:13).
 *
 * `build_bvh_buffer` throws the Rust `String` from
 * crates/gwen-core/src/build_tools.rs:43. The physics3d core refuses a bad
 * header with `PHYSICS3D:BVH_LOAD_FAILED`
 * (crates/gwen-core/src/physics3d/error.rs:207).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { unpackEntityId } from "../../src/index.js";
import type { WasmEnginePhysics3D } from "../../src/engine/wasm-bridge-types.js";
import { build_bvh_buffer, initSync } from "../../../physics3d/wasm/bvh/gwen_core.js";
import { createRealEngine, type RealEngineHandle } from "./harness.js";

/** Same bytes `bvh-worker.ts` fetches next to the glue. */
const BVH_WASM_PATH = fileURLToPath(
  new URL("../../../physics3d/wasm/bvh/gwen_core_bg.wasm", import.meta.url),
);
const BVH_WASM_BYTES = readFileSync(BVH_WASM_PATH);

/** 10×10 quad on y = 0. Winding matches the floor indices at physics3d_collider_results.rs:28. */
const QUAD_VERTICES = new Float32Array([-5, 0, -5, 5, 0, -5, -5, 0, 5, 5, 0, 5]);
const QUAD_INDICES = new Uint32Array([0, 2, 1, 1, 2, 3]);

const MAX_ENTITIES = 8;
/** wasm-bridge-types.ts:548 — 0 is Fixed. */
const FIXED_KIND = 0;
const ALL_BITS = 0xffffffff;
const COLLIDER_ID = 1;
const RAY_ORIGIN_Y = 5;
const RAY_DIRECTION_Y = -1;
const RAY_MAX_DISTANCE = 20;
/** One step fills the query pipeline (`pipeline.step` at crates/gwen-core/src/physics3d/world.rs:903). */
const STEP_DELTA = 1 / 60;

const OUT_OF_RANGE_INDEX = 4;

const EMPTY_VERTICES = new Float32Array(0);
const EMPTY_INDICES = new Uint32Array(0);

beforeAll(() => {
  initSync({ module: BVH_WASM_BYTES });
});

function physics3dBridge(handle: RealEngineHandle): WasmEnginePhysics3D {
  const bridge = handle.bridge.getPhysicsBridge();
  if (!("physics3d_add_body" in bridge)) {
    throw new Error("expected the physics3d bridge");
  }
  return bridge;
}

function caught(run: () => unknown): unknown {
  try {
    run();
  } catch (err: unknown) {
    return err;
  }
  return undefined;
}

function errorCode(err: unknown): string {
  if (typeof err !== "object" || err === null || !("code" in err)) return "";
  const code = err.code;
  return typeof code === "string" ? code : "";
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "";
}

function floatAt(values: Float32Array, index: number): number {
  const value = values[index];
  if (typeof value !== "number") {
    throw new Error("expected a ray float");
  }
  return value;
}

/** Flip the first header byte. The magic is `GBVH` (crates/gwen-core/src/build_tools.rs:170). */
function corruptBvhMagic(bytes: Uint8Array): Uint8Array {
  const copy = new Uint8Array(bytes);
  const magic = copy[0] ?? 0;
  copy[0] = magic ^ 0xff;
  return copy;
}

/** Copy `bytes` and add one to the GBVH header byte at `index` (major is 4, minor is 6). */
function bumpHeaderByte(bytes: Uint8Array, index: number): Uint8Array {
  const copy = new Uint8Array(bytes);
  const value = copy[index] ?? 0;
  copy[index] = (value + 1) & 0xff;
  return copy;
}

function loadCollider(raw: WasmEnginePhysics3D, slot: number, bytes: Uint8Array): boolean {
  const load = raw.physics3d_load_bvh_collider;
  if (load === undefined) {
    throw new Error("physics3d_load_bvh_collider is missing");
  }
  return load.call(raw, slot, bytes, 0, 0, 0, false, 0.5, 0, ALL_BITS, ALL_BITS, COLLIDER_ID);
}

function castRay(raw: WasmEnginePhysics3D): Float32Array {
  const cast = raw.physics3d_cast_ray;
  if (cast === undefined) {
    throw new Error("physics3d_cast_ray is missing");
  }
  return cast.call(
    raw,
    0,
    RAY_ORIGIN_Y,
    0,
    0,
    RAY_DIRECTION_Y,
    0,
    RAY_MAX_DISTANCE,
    ALL_BITS,
    ALL_BITS,
    true,
  );
}

async function withFixedBody(run: (raw: WasmEnginePhysics3D, slot: number) => void): Promise<void> {
  const handle = await createRealEngine({ variant: "physics3d", maxEntities: MAX_ENTITIES });
  try {
    const raw = physics3dBridge(handle);
    raw.physics3d_init(0, 0, 0, MAX_ENTITIES);
    const slot = unpackEntityId(handle.engine.createEntity()).index;
    expect(raw.physics3d_add_body(slot, 0, 0, 0, FIXED_KIND, 1, 0, 0)).toBe(true);
    run(raw, slot);
  } finally {
    await handle.dispose();
  }
}

describe("optimised bvh worker wasm", () => {
  it("the optimised bvh wasm builds a buffer the physics3d core accepts", async () => {
    const acceptedBvh = build_bvh_buffer(QUAD_VERTICES, QUAD_INDICES);
    expect(acceptedBvh).toBeInstanceOf(Uint8Array);
    expect(acceptedBvh.length).toBeGreaterThan(0);

    await withFixedBody((raw, slot) => {
      expect(loadCollider(raw, slot, acceptedBvh)).toBe(true);
      raw.physics3d_step(STEP_DELTA);
      const hit = castRay(raw);
      expect(hit.length).toBe(9);
      expect(floatAt(hit, 0)).toBe(1);
      expect(Math.abs(floatAt(hit, 2) - 5)).toBeLessThanOrEqual(1e-4);
    });
  });

  it("a bvh buffer baked for another Rapier version is refused with BVH_LOAD_FAILED", async () => {
    const baked = build_bvh_buffer(QUAD_VERTICES, QUAD_INDICES);
    const wrongMinor = bumpHeaderByte(baked, 6);
    const wrongMajor = bumpHeaderByte(baked, 4);

    await withFixedBody((raw, slot) => {
      const thrown = caught(() => loadCollider(raw, slot, wrongMinor));
      expect(errorCode(thrown)).toBe("PHYSICS3D:BVH_LOAD_FAILED");
      expect(errorMessage(thrown)).toBe(
        "BVH load failed: the buffer was baked for another Rapier version, bake it again",
      );
    });
    await withFixedBody((raw, slot) => {
      const thrown = caught(() => loadCollider(raw, slot, wrongMajor));
      expect(errorCode(thrown)).toBe("PHYSICS3D:BVH_LOAD_FAILED");
      expect(errorMessage(thrown)).toBe(
        "BVH load failed: the buffer was baked for another Rapier version, bake it again",
      );
    });
  });

  it("a corrupted bvh buffer is refused by the physics3d core with BVH_LOAD_FAILED", async () => {
    const corruptedBvh = corruptBvhMagic(build_bvh_buffer(QUAD_VERTICES, QUAD_INDICES));

    await withFixedBody((raw, slot) => {
      const thrown = caught(() => loadCollider(raw, slot, corruptedBvh));
      expect(errorCode(thrown)).toBe("PHYSICS3D:BVH_LOAD_FAILED");
      expect(errorMessage(thrown)).toBe("BVH load failed: the magic is not GBVH");
    });
  });

  it("an index out of range is refused by build_bvh_buffer with an error string", () => {
    const outOfRangeIndices = new Uint32Array([0, 1, OUT_OF_RANGE_INDEX]);
    const thrown = caught(() => build_bvh_buffer(QUAD_VERTICES, outOfRangeIndices));
    expect(typeof thrown).toBe("string");
    expect(thrown).toBe("index 4 is outside the vertex count 4");
  });

  it("an empty mesh is refused", () => {
    const thrown = caught(() => build_bvh_buffer(EMPTY_VERTICES, EMPTY_INDICES));
    expect(typeof thrown).toBe("string");
    expect(thrown).toBe("indices_flat must contain at least one triangle");
  });
});

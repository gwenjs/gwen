import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeAll } from "vitest";
import { initSync, voronoi_fracture } from "../src/index.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// A simple tetrahedron: 4 vertices, 4 triangular faces
const vertices = new Float32Array([
  0,
  0,
  0, // 0
  1,
  0,
  0, // 1
  0.5,
  1,
  0, // 2
  0.5,
  0.3,
  1, // 3
]);
const indices = new Uint32Array([0, 1, 2, 0, 1, 3, 0, 2, 3, 1, 2, 3]);

// Impact point roughly at the centroid
const ix = 0.5,
  iy = 0.3,
  iz = 0.25;

beforeAll(() => {
  const wasmPath = resolve(__dirname, "../wasm/gwen_physics3d_fracture_bg.wasm");
  const bytes = readFileSync(wasmPath);
  try {
    initSync({ module: bytes });
  } catch {
    // Fallback: pass bytes directly (older wasm-bindgen API)
    initSync(bytes);
  }
});

describe("voronoi_fracture", () => {
  it("nominal case: simple tetrahedron returns non-empty Float32Array", () => {
    const result = voronoi_fracture(vertices, indices, ix, iy, iz, 4, 42);
    expect(result).toBeInstanceOf(Float32Array);
    expect(result.length).toBeGreaterThan(0);
  });

  it("reproducibility: same seed produces identical results", () => {
    const a = voronoi_fracture(vertices, indices, ix, iy, iz, 4, 123);
    const b = voronoi_fracture(vertices, indices, ix, iy, iz, 4, 123);
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) {
      expect(a[i]).toBe(b[i]);
    }
  });

  it("different seeds produce different results", () => {
    // Seeds 1 and 42 are known to produce different output lengths for this mesh
    const a = voronoi_fracture(vertices, indices, ix, iy, iz, 4, 1);
    const b = voronoi_fracture(vertices, indices, ix, iy, iz, 4, 42);
    // The simplest discriminator: output buffer lengths differ
    expect(a.length).not.toBe(b.length);
  });

  it("empty mesh returns empty Float32Array", () => {
    const result = voronoi_fracture(new Float32Array(0), new Uint32Array(0), 0, 0, 0, 4, 42);
    expect(result).toBeInstanceOf(Float32Array);
    expect(result.length).toBe(0);
  });

  it("shard_count = 1 returns non-empty result", () => {
    const result = voronoi_fracture(vertices, indices, ix, iy, iz, 1, 42);
    expect(result).toBeInstanceOf(Float32Array);
    expect(result.length).toBeGreaterThan(0);
  });

  it("high shard_count (64) returns non-empty result", () => {
    const result = voronoi_fracture(vertices, indices, ix, iy, iz, 64, 42);
    expect(result).toBeInstanceOf(Float32Array);
    expect(result.length).toBeGreaterThan(0);
  });
});

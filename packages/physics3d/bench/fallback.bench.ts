/**
 * Benchmarks for the Physics3D TypeScript fallback simulation step.
 *
 * Baseline machine: Apple M-series, Node 20.
 * Run with: pnpm --filter @gwenjs/physics3d exec vitest bench
 */
import { bench, describe, vi, beforeAll } from "vitest";

// ─── Minimal mock WASM bridge (local / fallback mode) ─────────────────────────
// No `physics3d_add_body` export → forces the plugin into TypeScript fallback.

vi.mock("@gwenjs/core/internal", async () => {
  const core = await import("@gwenjs/core");
  return { getWasmBridge: core.getWasmBridge };
});

vi.mock("@gwenjs/core", () => ({
  getWasmBridge: () => ({
    variant: "physics3d" as const,
    getPhysicsBridge: () => ({
      physics3d_init: () => undefined,
      physics3d_step: () => undefined,
      // No physics3d_add_body → local simulation mode
    }),
    getEntityGeneration: (_i: number) => 0,
  }),
  unpackEntityId: (id: bigint) => ({
    index: Number(id & 0xffffffffn),
    generation: Number((id >> 32n) & 0xffffffffn),
  }),
  createEntityId: (index: number, generation: number) =>
    BigInt(index) | (BigInt(generation) << 32n),
}));

import { Physics3DPlugin, type Physics3DAPI } from "../src/index";
import type { GwenEngine } from "@gwenjs/core";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEngine() {
  const services = new Map<string, unknown>();
  const hookMap = new Map<string, (...args: unknown[]) => unknown>();
  const engine = {
    provide: (name: string, value: unknown) => services.set(name, value),
    inject: (name: string) => services.get(name),
    hooks: {
      hook: (name: string, cb: (...args: unknown[]) => unknown) => {
        hookMap.set(name, cb);
        return () => undefined;
      },
      callHook: () => undefined,
    },
    getEntityGeneration: () => 0,
    query: () => [],
    getComponent: () => null,
    wasmBridge: null,
  } as unknown as GwenEngine;
  return { engine, services, hookMap };
}

/**
 * Create and initialize a plugin in local mode.
 * Returns the plugin instance and the service API.
 */
function createPlugin(gravity = { x: 0, y: -9.81, z: 0 }) {
  const plugin = Physics3DPlugin({ gravity });
  const { engine, services, hookMap } = makeEngine();
  plugin.setup(engine);
  const service = services.get("physics3d") as Physics3DAPI;
  return { plugin, service, hookMap };
}

/**
 * Register `count` dynamic bodies with box colliders at random positions.
 * All bodies start at slightly different locations to trigger mixed overlap scenarios.
 */
function registerBodies(service: Physics3DAPI, count: number, spacing: number): void {
  for (let i = 0; i < count; i++) {
    const id = BigInt(i + 1);
    const x = (i % 10) * spacing;
    const z = Math.floor(i / 10) * spacing;
    service.createBody(id, {
      kind: "dynamic",
      initialPosition: { x, y: 0, z },
      initialLinearVelocity: { x: 0.1, y: 0, z: 0 },
      linearDamping: 0.05,
      angularDamping: 0.05,
    });
    service.addCollider(id, {
      shape: { type: "box", halfX: 0.5, halfY: 0.5, halfZ: 0.5 },
      colliderId: 0,
    });
  }
}

// ─── Benchmarks ───────────────────────────────────────────────────────────────

describe("Physics3D fallback — simulation step", () => {
  // ─── 50 dynamic bodies, no collisions ─────────────────────────────────────
  let service50: Physics3DAPI;
  let before50: (...args: unknown[]) => unknown;
  let update50: (...args: unknown[]) => unknown;

  beforeAll(() => {
    const p = createPlugin({ x: 0, y: -9.81, z: 0 });
    service50 = p.service;
    const before = p.hookMap.get("engine:before-update");
    const update = p.hookMap.get("engine:update");
    if (before === undefined || update === undefined) {
      throw new Error("physics frame hooks were not registered");
    }
    before50 = before;
    update50 = update;
    // Space bodies 5 m apart — far enough that no box (half=0.5m) overlaps
    registerBodies(service50, 50, 5);
  });

  bench("step with 50 dynamic bodies (no collisions)", () => {
    before50(1 / 60);
    update50();
  });

  // ─── 50 dynamic bodies, worst-case all overlapping ────────────────────────
  let service50overlap: Physics3DAPI;
  let before50overlap: (...args: unknown[]) => unknown;
  let update50overlap: (...args: unknown[]) => unknown;

  beforeAll(() => {
    const p = createPlugin({ x: 0, y: 0, z: 0 });
    service50overlap = p.service;
    const before = p.hookMap.get("engine:before-update");
    const update = p.hookMap.get("engine:update");
    if (before === undefined || update === undefined) {
      throw new Error("physics frame hooks were not registered");
    }
    before50overlap = before;
    update50overlap = update;
    // Place all bodies at the origin — every pair of bodies overlaps
    for (let i = 0; i < 50; i++) {
      const id = BigInt(i + 1);
      service50overlap.createBody(id, {
        kind: "dynamic",
        initialPosition: { x: 0, y: 0, z: 0 },
      });
      service50overlap.addCollider(id, {
        shape: { type: "box", halfX: 2, halfY: 2, halfZ: 2 },
        colliderId: 0,
      });
    }
  });

  bench("step with 50 dynamic bodies (all overlapping — worst case)", () => {
    before50overlap(1 / 60);
    update50overlap();
  });

  // ─── 200 bodies, realistic scene (some overlap, most separated) ───────────
  let service200: Physics3DAPI;
  let before200: (...args: unknown[]) => unknown;
  let update200: (...args: unknown[]) => unknown;

  beforeAll(() => {
    const p = createPlugin({ x: 0, y: -9.81, z: 0 });
    service200 = p.service;
    const before = p.hookMap.get("engine:before-update");
    const update = p.hookMap.get("engine:update");
    if (before === undefined || update === undefined) {
      throw new Error("physics frame hooks were not registered");
    }
    before200 = before;
    update200 = update;
    // Bodies in a 20×10 grid, 2 m apart. Adjacent bodies are 1 m edge-to-edge
    // (box half=0.5 m, gap=1 m) — a realistic density where a few may drift into each other.
    registerBodies(service200, 200, 2);
  });

  bench("step with 200 bodies (realistic scene)", () => {
    before200(1 / 60);
    update200();
  });
});

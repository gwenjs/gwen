/**
 * Benchmarks for the Physics3D TypeScript fallback simulation step.
 *
 * Baseline machine: Apple M-series, Node 20.
 * Run with: pnpm --filter @gwenjs/physics3d exec vitest bench
 */
import { bench, describe, vi, beforeAll } from 'vitest';

// ─── Minimal mock WASM bridge (local / fallback mode) ─────────────────────────
// No `physics3d_add_body` export → forces the plugin into TypeScript fallback.

vi.mock('@gwenjs/core', () => ({
  getWasmBridge: () => ({
    variant: 'physics3d' as const,
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

import { Physics3DPlugin, type Physics3DAPI } from '../src/index';
import type { GwenEngine } from '@gwenjs/core';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEngine() {
  const services = new Map<string, unknown>();
  const engine = {
    provide: (name: string, value: unknown) => services.set(name, value),
    inject: (name: string) => services.get(name),
    hooks: {
      hook: (_name: string, _cb: unknown) => () => undefined,
      callHook: () => undefined,
    },
    getEntityGeneration: () => 0,
    query: () => [],
    getComponent: () => null,
    wasmBridge: null,
  } as unknown as GwenEngine;
  return { engine, services };
}

/**
 * Create and initialize a plugin in local mode.
 * Returns the plugin instance and the service API.
 */
function createPlugin(gravity = { x: 0, y: -9.81, z: 0 }) {
  const plugin = Physics3DPlugin({ gravity });
  const { engine, services } = makeEngine();
  plugin.setup(engine);
  const service = services.get('physics3d') as Physics3DAPI;
  return { plugin, service };
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
      kind: 'dynamic',
      initialPosition: { x, y: 0, z },
      initialLinearVelocity: { x: 0.1, y: 0, z: 0 },
      linearDamping: 0.05,
      angularDamping: 0.05,
    });
    service.addCollider(id, {
      shape: { type: 'box', halfX: 0.5, halfY: 0.5, halfZ: 0.5 },
      colliderId: 0,
    });
  }
}

// ─── Benchmarks ───────────────────────────────────────────────────────────────

describe('Physics3D fallback — simulation step', () => {
  // ─── 50 dynamic bodies, no collisions ─────────────────────────────────────
  let plugin50: ReturnType<typeof Physics3DPlugin>;
  let service50: Physics3DAPI;

  beforeAll(() => {
    const p = createPlugin({ x: 0, y: -9.81, z: 0 });
    plugin50 = p.plugin;
    service50 = p.service;
    // Space bodies 5 m apart — far enough that no box (half=0.5m) overlaps
    registerBodies(service50, 50, 5);
  });

  bench('step with 50 dynamic bodies (no collisions)', () => {
    plugin50.onBeforeUpdate!(1 / 60);
    plugin50.onUpdate!();
  });

  // ─── 50 dynamic bodies, worst-case all overlapping ────────────────────────
  let plugin50overlap: ReturnType<typeof Physics3DPlugin>;
  let service50overlap: Physics3DAPI;

  beforeAll(() => {
    const p = createPlugin({ x: 0, y: 0, z: 0 });
    plugin50overlap = p.plugin;
    service50overlap = p.service;
    // Place all bodies at the origin — every pair of bodies overlaps
    for (let i = 0; i < 50; i++) {
      const id = BigInt(i + 1);
      service50overlap.createBody(id, {
        kind: 'dynamic',
        initialPosition: { x: 0, y: 0, z: 0 },
      });
      service50overlap.addCollider(id, {
        shape: { type: 'box', halfX: 2, halfY: 2, halfZ: 2 },
        colliderId: 0,
      });
    }
  });

  bench('step with 50 dynamic bodies (all overlapping — worst case)', () => {
    plugin50overlap.onBeforeUpdate!(1 / 60);
    plugin50overlap.onUpdate!();
  });

  // ─── 200 bodies, realistic scene (some overlap, most separated) ───────────
  let plugin200: ReturnType<typeof Physics3DPlugin>;
  let service200: Physics3DAPI;

  beforeAll(() => {
    const p = createPlugin({ x: 0, y: -9.81, z: 0 });
    plugin200 = p.plugin;
    service200 = p.service;
    // Bodies in a 20×10 grid, 2 m apart. Adjacent bodies are 1 m edge-to-edge
    // (box half=0.5 m, gap=1 m) — a realistic density where a few may drift into each other.
    registerBodies(service200, 200, 2);
  });

  bench('step with 200 bodies (realistic scene)', () => {
    plugin200.onBeforeUpdate!(1 / 60);
    plugin200.onUpdate!();
  });
});

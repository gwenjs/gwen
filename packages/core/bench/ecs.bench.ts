/**
 * Benchmark: TS-only vs WASM core
 *
 * Compares ECS operation performance between the pure TypeScript implementation
 * and the Rust/WASM core (when available).
 *
 * Run:
 *   pnpm --filter @gwenjs/core bench
 *
 * Without WASM (.wasm not loaded), only the TS columns are shown.
 * With WASM active (after initWasm()), both columns are compared.
 */

import { bench, describe } from 'vitest';
import { EntityManager, ComponentRegistry, QueryEngine } from '../src/core/ecs';
import { getWasmBridge, _resetWasmBridge } from '../src/engine/wasm-bridge';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTsEcs(maxEntities = 10_000) {
  const em = new EntityManager(maxEntities);
  const cr = new ComponentRegistry();
  const qe = new QueryEngine();
  return { em, cr, qe };
}

// ── Benchmark 1: entity creation ─────────────────────────────────────────────

describe('Entity creation — 1 000 entities', () => {
  bench('TS-only', () => {
    const { em } = makeTsEcs(1_000);
    for (let i = 0; i < 1_000; i++) em.create();
  });

  bench('WASM (if active)', () => {
    const bridge = getWasmBridge();
    if (!bridge.isActive()) return; // Skip gracefully if WASM not loaded
    for (let i = 0; i < 1_000; i++) bridge.createEntity();
  });
});

describe('Entity creation — 10 000 entities', () => {
  bench('TS-only', () => {
    const { em } = makeTsEcs(10_000);
    for (let i = 0; i < 10_000; i++) em.create();
  });

  bench('WASM (if active)', () => {
    const bridge = getWasmBridge();
    if (!bridge.isActive()) return;
    for (let i = 0; i < 10_000; i++) bridge.createEntity();
  });
});

// ── Benchmark 2 : is_alive / isAlive ─────────────────────────────────────────

describe('isAlive — 10 000 checks', () => {
  const { em } = makeTsEcs(1);
  const tsId = em.create();

  bench('TS-only', () => {
    for (let i = 0; i < 10_000; i++) em.isAlive(tsId);
  });

  bench('WASM (if active)', () => {
    const bridge = getWasmBridge();
    if (!bridge.isActive()) return;
    const id = bridge.createEntity()!;
    for (let i = 0; i < 10_000; i++) bridge.isAlive(id.index, id.generation);
  });
});

// ── Benchmark 3 : add + get composant ────────────────────────────────────────

describe('Component add + get — 1 000 entities', () => {
  bench('TS-only', () => {
    const { em, cr } = makeTsEcs(1_000);
    const ids = Array.from({ length: 1_000 }, () => em.create());
    for (const id of ids) cr.add(id, 'Position', { x: 0, y: 0 });
    for (const id of ids) cr.get(id, 'Position');
  });

  bench('WASM (if active)', () => {
    const bridge = getWasmBridge();
    if (!bridge.isActive()) return;
    const typeId = bridge.registerComponentType()!;
    const data = new Uint8Array(8); // 2× f32
    const ids: Array<{ index: number; generation: number }> = [];
    for (let i = 0; i < 1_000; i++) {
      const id = bridge.createEntity()!;
      ids.push(id);
      bridge.addComponent(id.index, id.generation, typeId, data);
    }
    for (const id of ids) bridge.getComponentRaw(id.index, id.generation, typeId);
  });
});

// ── Benchmark 4 : query ───────────────────────────────────────────────────────

describe('Query — 1 000 entities, 1 component type', () => {
  bench('TS-only', () => {
    const { em, cr, qe } = makeTsEcs(1_000);
    for (let i = 0; i < 1_000; i++) {
      const id = em.create();
      cr.add(id, 'Position', { x: i, y: 0 });
    }
    qe.query(['Position'], em, cr);
  });

  bench('WASM (if active)', () => {
    const bridge = getWasmBridge();
    if (!bridge.isActive()) return;
    const typeId = bridge.registerComponentType()!;
    const data = new Uint8Array(8);
    for (let i = 0; i < 1_000; i++) {
      const id = bridge.createEntity()!;
      bridge.addComponent(id.index, id.generation, typeId, data);
      bridge.updateEntityArchetype(id.index, [typeId]);
    }
    bridge.queryEntities([typeId]);
  });
});

// ── Benchmark 5 : entity lifecycle (create + delete) ─────────────────────────

describe('Entity lifecycle (create + delete) — 5 000 cycles', () => {
  bench('TS-only', () => {
    const { em } = makeTsEcs(5_000);
    const ids = Array.from({ length: 5_000 }, () => em.create());
    for (const id of ids) em.destroy(id);
  });

  bench('WASM (if active)', () => {
    const bridge = getWasmBridge();
    if (!bridge.isActive()) return;
    const ids: Array<{ index: number; generation: number }> = [];
    for (let i = 0; i < 5_000; i++) ids.push(bridge.createEntity()!);
    for (const id of ids) bridge.deleteEntity(id.index, id.generation);
  });
});

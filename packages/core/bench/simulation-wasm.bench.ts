/**
 * Benchmark: Frame simulation — WASM ECS vs TypeScript ECS
 *
 * Loads the real `gwen-core.wasm` (light variant) and runs the same
 * movement update scenarios as `simulation.bench.ts` through the Rust ECS,
 * so you can compare both paths side-by-side.
 *
 * WASM path per frame:
 *   1. query_entities(typeIds) → slot indices (Uint32Array)
 *   2. get_component_raw(slot, gen, typeId) → Uint8Array (Rust heap, zero-copy)
 *   3. DataView read x/y + vx/vy
 *   4. DataView write updated position into a local Uint8Array
 *   5. add_component(slot, gen, typeId, bytes) → overwrite on Rust heap
 *
 * Run:
 *   pnpm --filter @gwenjs/core exec vitest bench --run bench/simulation-wasm.bench.ts
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bench, describe } from 'vitest';

// ── TS ECS (for comparison) ───────────────────────────────────────────────
import { EntityManager, ComponentRegistry, QueryEngine } from '../src/core/ecs';
import { defineComponent, Types } from '../src/schema';
import type { EntityId as _EntityId } from '../src/types/entity';

// ── WASM bootstrap (synchronous) ──────────────────────────────────────────

const _require = createRequire(import.meta.url);
const _dir = dirname(fileURLToPath(import.meta.url));

const WASM_GLUE = resolve(_dir, '../wasm/light/gwen_core.js');
const WASM_BIN = resolve(_dir, '../wasm/light/gwen_core_bg.wasm');

/** Minimal shape of a wasm-bindgen Engine instance */
interface RawWasmEngine {
  create_entity(): { index: number; generation: number };
  register_component_type(): number;
  add_component(index: number, generation: number, typeId: number, data: Uint8Array): boolean;
  get_component_raw(index: number, generation: number, typeId: number): Uint8Array;
  update_entity_archetype(index: number, typeIds: Uint32Array): void;
  query_entities(typeIds: Uint32Array): Uint32Array;
  query_entities_to_buffer(typeIds: Uint32Array): number;
}

interface WasmGlue {
  initSync(opts: { module: ArrayBuffer | Uint8Array }): unknown;
  Engine: new (maxEntities: number) => RawWasmEngine;
}

/** Load the WASM binary and return a fresh Engine instance (synchronous). */
function loadWasmEngine(maxEntities: number): RawWasmEngine {
  const glue = _require(WASM_GLUE) as WasmGlue;
  const wasmBytes = readFileSync(WASM_BIN);
  glue.initSync({ module: wasmBytes });
  return new glue.Engine(maxEntities);
}

// ── Constants ─────────────────────────────────────────────────────────────

const DT = 1 / 60;
const COMP_BYTES = 8; // 2 × f32 per component

// ── Component definitions (TS ECS) ────────────────────────────────────────

const Position = defineComponent({ name: 'Position', schema: { x: Types.f32, y: Types.f32 } });
const Velocity = defineComponent({ name: 'Velocity', schema: { vx: Types.f32, vy: Types.f32 } });

// ── WASM world ────────────────────────────────────────────────────────────

interface WasmWorld {
  engine: RawWasmEngine;
  posTypeId: number;
  velTypeId: number;
}

function buildWasmWorld(n: number): WasmWorld {
  const engine = loadWasmEngine(n + 64);
  const posTypeId = engine.register_component_type();
  const velTypeId = engine.register_component_type();
  const posBuf = new Uint8Array(COMP_BYTES);
  const velBuf = new Uint8Array(COMP_BYTES);
  const archetypeIds = new Uint32Array([posTypeId, velTypeId]);

  for (let i = 0; i < n; i++) {
    const eid = engine.create_entity();
    const dv1 = new DataView(posBuf.buffer);
    dv1.setFloat32(0, i * 1.0, true);
    dv1.setFloat32(4, 0.0, true);
    const dv2 = new DataView(velBuf.buffer);
    dv2.setFloat32(0, 1.0, true);
    dv2.setFloat32(4, 0.5, true);
    engine.add_component(eid.index, eid.generation, posTypeId, posBuf.slice());
    engine.add_component(eid.index, eid.generation, velTypeId, velBuf.slice());
    engine.update_entity_archetype(eid.index, archetypeIds);
  }
  return { engine, posTypeId, velTypeId };
}

/** One movement frame on the WASM path. */
function runWasmFrame(world: WasmWorld): void {
  const { engine, posTypeId, velTypeId } = world;
  const typeIds = new Uint32Array([posTypeId, velTypeId]);
  const slots = engine.query_entities(typeIds);
  const writeBuf = new Uint8Array(COMP_BYTES);

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i]!;
    const rawPos = engine.get_component_raw(slot, 0, posTypeId);
    const rawVel = engine.get_component_raw(slot, 0, velTypeId);
    const pvPos = new DataView(rawPos.buffer, rawPos.byteOffset);
    const pvVel = new DataView(rawVel.buffer, rawVel.byteOffset);
    const nx = pvPos.getFloat32(0, true) + pvVel.getFloat32(0, true) * DT;
    const ny = pvPos.getFloat32(4, true) + pvVel.getFloat32(4, true) * DT;
    const out = new DataView(writeBuf.buffer);
    out.setFloat32(0, nx, true);
    out.setFloat32(4, ny, true);
    engine.add_component(slot, 0, posTypeId, writeBuf);
  }
}

// ── TS ECS world ──────────────────────────────────────────────────────────

interface TsWorld {
  em: EntityManager;
  cr: ComponentRegistry;
  qe: QueryEngine;
}

function buildTsWorld(n: number): TsWorld {
  const em = new EntityManager(n);
  const cr = new ComponentRegistry();
  const qe = new QueryEngine();
  for (let i = 0; i < n; i++) {
    const id = em.create();
    cr.add(id, Position, { x: i * 1.0, y: 0.0 });
    cr.add(id, Velocity, { vx: 1.0, vy: 0.5 });
  }
  return { em, cr, qe };
}

function runTsFrame(ts: TsWorld): void {
  const entities = ts.qe.resolve([Position, Velocity], ts.em, ts.cr);
  for (const id of entities) {
    const pos = ts.cr.get<{ x: number; y: number }>(id, Position)!;
    const vel = ts.cr.get<{ vx: number; vy: number }>(id, Velocity)!;
    ts.cr.add(id, Position, { x: pos.x + vel.vx * DT, y: pos.y + vel.vy * DT });
  }
  ts.qe.invalidate();
}

// ── Module-level world setup (avoids beforeAll timing issues) ─────────────

const _wasm1k = buildWasmWorld(1_000);
const _wasm5k = buildWasmWorld(5_000);
const _wasm10k = buildWasmWorld(10_000);

const _ts1k = buildTsWorld(1_000);
const _ts5k = buildTsWorld(5_000);
const _ts10k = buildTsWorld(10_000);

// ── 1. Movement system — 1 frame ─────────────────────────────────────────

describe('WASM ECS movement system — 1 frame', () => {
  bench('1 000 entities', () => runWasmFrame(_wasm1k));
  bench('5 000 entities', () => runWasmFrame(_wasm5k));
  bench('10 000 entities', () => runWasmFrame(_wasm10k));
});

// ── 2. TS ECS movement system — 1 frame (same workload, for comparison) ──

describe('TS ECS movement system — 1 frame', () => {
  bench('1 000 entities', () => runTsFrame(_ts1k));
  bench('5 000 entities', () => runTsFrame(_ts5k));
  bench('10 000 entities', () => runTsFrame(_ts10k));
});

// ── 3. Side-by-side summary — 1 000 entities ─────────────────────────────

const _wasmSbs = buildWasmWorld(1_000);
const _tsSbs = buildTsWorld(1_000);

describe('Side-by-side: TS vs WASM ECS — 1 000 entities, 1 frame', () => {
  bench('TypeScript ECS', () => runTsFrame(_tsSbs));
  bench('Rust WASM ECS', () => runWasmFrame(_wasmSbs));
});

// ── 4. 100-frame sustained simulation ────────────────────────────────────

describe('Sustained 100-frame simulation — WASM vs TS', () => {
  bench('WASM — 1 000 entities × 100 frames', () => {
    const w = buildWasmWorld(1_000);
    for (let f = 0; f < 100; f++) runWasmFrame(w);
  });

  bench('TS — 1 000 entities × 100 frames', () => {
    const ts = buildTsWorld(1_000);
    for (let f = 0; f < 100; f++) runTsFrame(ts);
  });

  bench('WASM — 5 000 entities × 100 frames', () => {
    const w = buildWasmWorld(5_000);
    for (let f = 0; f < 100; f++) runWasmFrame(w);
  });

  bench('TS — 5 000 entities × 100 frames', () => {
    const ts = buildTsWorld(5_000);
    for (let f = 0; f < 100; f++) runTsFrame(ts);
  });
});

// ── 5. Query-only cost (no writes) ───────────────────────────────────────

const _wasmQO = buildWasmWorld(5_000);
const _tsQO = buildTsWorld(5_000);

describe('Query-only cost (no writes) — 5 000 entities', () => {
  bench('WASM query_entities()', () => {
    _wasmQO.engine.query_entities(new Uint32Array([_wasmQO.posTypeId, _wasmQO.velTypeId]));
  });

  bench('TS QueryEngine.resolve()', () => {
    _tsQO.qe.resolve([Position, Velocity], _tsQO.em, _tsQO.cr);
    _tsQO.qe.invalidate();
  });
});

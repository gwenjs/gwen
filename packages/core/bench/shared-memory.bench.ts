/**
 * Benchmark: Shared-memory movement patterns
 *
 * Answers the question: how much faster is a WASM plugin that owns its data
 * in a flat shared buffer compared to the current "chatty API" (3N crossings)?
 *
 * Three paths are compared:
 *
 *  A) Chatty WASM ECS  (current state)
 *     query → get_component_raw × N → add_component × N
 *     = 3N JS↔WASM crossings + 2N allocations per frame
 *
 *  B) Flat Float32Array — entities live outside ECS, in a JS-owned buffer
 *     All state stored as [x, y, vx, vy, ...] in a single Float32Array.
 *     Movement loop runs entirely in JS with zero WASM crossings.
 *     → Model for a particle system / projectile pool that does NOT need ECS.
 *       The renderer reads the buffer directly (handle.region().f32).
 *
 *  C) WASM linear memory — same layout as B but buffer lives inside the WASM
 *     heap (allocated via alloc_shared_buffer). JS accesses it through a typed-
 *     array view pointing into engine.memory.buffer — zero copies, zero allocs.
 *     → Production model: Rust plugin allocates once at init, JS (or Rust) writes
 *       positions each frame.  When the loop moves to Rust: 1 crossing total.
 *
 * ─── Use-case map ────────────────────────────────────────────────────────────
 *
 *   Particles / projectiles / scrolling stars (no per-entity game logic)
 *     → Path B or C (flat buffer, no ECS)    Expected: 10 000 entities < 0.1 ms
 *
 *   Enemies / NPCs that need full ECS (health, AI state, inventory …)
 *     → Path A today, Path C via step_movement_system tomorrow
 *
 *   Physics-driven entities (Rapier2D/3D)
 *     → Already optimal — physics_step = 1 crossing (not benchmarked here)
 *
 * Run:
 *   pnpm --filter @gwenjs/core exec vitest bench --run bench/shared-memory.bench.ts
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bench, describe } from 'vitest';

// ── WASM bootstrap ────────────────────────────────────────────────────────────

const _require = createRequire(import.meta.url);
const _dir = dirname(fileURLToPath(import.meta.url));

const WASM_GLUE = resolve(_dir, '../wasm/light/gwen_core.js');
const WASM_BIN = resolve(_dir, '../wasm/light/gwen_core_bg.wasm');

interface RawWasmEngine {
  create_entity(): { index: number; generation: number };
  register_component_type(): number;
  add_component(index: number, generation: number, typeId: number, data: Uint8Array): boolean;
  get_component_raw(index: number, generation: number, typeId: number): Uint8Array;
  get_components_bulk(
    slots: Uint32Array,
    gens: Uint32Array,
    typeId: number,
    outBuf: Uint8Array,
  ): number;
  set_components_bulk(
    slots: Uint32Array,
    gens: Uint32Array,
    typeId: number,
    data: Uint8Array,
  ): void;
  update_entity_archetype(index: number, typeIds: Uint32Array): void;
  query_entities(typeIds: Uint32Array): Uint32Array;
  alloc_shared_buffer(byteLength: number): number;
}

interface WasmExports {
  memory: WebAssembly.Memory;
}

interface WasmGlue {
  initSync(opts: { module: ArrayBuffer | Uint8Array }): WasmExports;
  Engine: new (maxEntities: number) => RawWasmEngine;
}

function loadWasmEngine(maxEntities: number): {
  engine: RawWasmEngine;
  memory: WebAssembly.Memory;
} {
  const glue = _require(WASM_GLUE) as WasmGlue;
  const wasmBytes = readFileSync(WASM_BIN);
  const exports = glue.initSync({ module: wasmBytes });
  return { engine: new glue.Engine(maxEntities), memory: exports.memory };
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DT = 1 / 60;
const COMP_BYTES = 8; // 2 × f32 for Position / Velocity components
const FLAT_STRIDE = 4; // f32 elements per entity: [x, y, vx, vy]

// ── Path A — Chatty WASM ECS (current baseline) ───────────────────────────────

interface WasmEcsWorld {
  engine: RawWasmEngine;
  posTypeId: number;
  velTypeId: number;
}

function buildWasmEcsWorld(n: number): WasmEcsWorld {
  const { engine } = loadWasmEngine(n + 64);
  const posTypeId = engine.register_component_type();
  const velTypeId = engine.register_component_type();
  const posBuf = new Uint8Array(COMP_BYTES);
  const velBuf = new Uint8Array(COMP_BYTES);
  const archetype = new Uint32Array([posTypeId, velTypeId]);

  for (let i = 0; i < n; i++) {
    const eid = engine.create_entity();
    const dp = new DataView(posBuf.buffer);
    dp.setFloat32(0, i * 1.0, true);
    dp.setFloat32(4, 0.0, true);
    const dv = new DataView(velBuf.buffer);
    dv.setFloat32(0, 1.0, true);
    dv.setFloat32(4, 0.5, true);
    engine.add_component(eid.index, eid.generation, posTypeId, posBuf.slice());
    engine.add_component(eid.index, eid.generation, velTypeId, velBuf.slice());
    engine.update_entity_archetype(eid.index, archetype);
  }
  return { engine, posTypeId, velTypeId };
}

/** Current implementation: 3N JS↔WASM crossings per frame. */
function runChattyWasmFrame(world: WasmEcsWorld): void {
  const { engine, posTypeId, velTypeId } = world;
  const slots = engine.query_entities(new Uint32Array([posTypeId, velTypeId]));
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

// ── Path B — Flat Float32Array (JS-owned buffer, outside WASM heap) ───────────

interface FlatBufferWorld {
  buf: Float32Array;
  count: number;
}

function buildFlatBufferWorld(n: number): FlatBufferWorld {
  const buf = new Float32Array(n * FLAT_STRIDE);
  for (let i = 0; i < n; i++) {
    buf[i * FLAT_STRIDE + 0] = i * 1.0; // x
    buf[i * FLAT_STRIDE + 1] = 0.0; // y
    buf[i * FLAT_STRIDE + 2] = 1.0; // vx
    buf[i * FLAT_STRIDE + 3] = 0.5; // vy
  }
  return { buf, count: n };
}

/**
 * Movement loop on a plain JS Float32Array — 0 WASM crossings.
 * In production this function lives in Rust (step_movement_system = 1 crossing).
 */
function runFlatBufferFrame(world: FlatBufferWorld): void {
  const { buf, count } = world;
  for (let i = 0; i < count; i++) {
    const base = i * FLAT_STRIDE;
    buf[base + 0] += buf[base + 2] * DT; // x += vx * dt
    buf[base + 1] += buf[base + 3] * DT; // y += vy * dt
  }
}

// ── Path C — Buffer allocated inside WASM linear memory ───────────────────────
//
// alloc_shared_buffer() carves out N×16 bytes inside the WASM heap and returns
// a raw pointer.  JS wraps it in a Float32Array view pointing directly into
// engine.memory.buffer — zero copies, zero allocations per frame.
//
// This is the realistic model for a community WASM plugin using loadWasmModule:
//   handle.region('positions').f32   →  exactly this Float32Array view
//
// The movement loop is identical to Path B; the only difference is that the
// backing memory lives inside the WASM heap rather than the JS heap.  In a real
// game the loop would run in Rust (handle.exports.step(dt) = 1 crossing).

interface WasmPtrWorld {
  engine: RawWasmEngine;
  ptr: number;
  /** Fresh view on every call — never cache across frames (memory.grow safety). */
  view: () => Float32Array;
  count: number;
}

function buildWasmPtrWorld(n: number): WasmPtrWorld {
  const { engine, memory } = loadWasmEngine(n + 64);
  const byteLength = n * FLAT_STRIDE * 4; // 4 bytes per f32
  const ptr = engine.alloc_shared_buffer(byteLength);

  // Initialise via a first view
  const init = new Float32Array(memory.buffer, ptr, n * FLAT_STRIDE);
  for (let i = 0; i < n; i++) {
    init[i * FLAT_STRIDE + 0] = i * 1.0;
    init[i * FLAT_STRIDE + 1] = 0.0;
    init[i * FLAT_STRIDE + 2] = 1.0;
    init[i * FLAT_STRIDE + 3] = 0.5;
  }

  return {
    engine,
    ptr,
    view: () => new Float32Array(memory.buffer, ptr, n * FLAT_STRIDE),
    count: n,
  };
}

/**
 * Movement loop on buffer that lives in WASM linear memory.
 * JS reads/writes via a typed-array view — no serialisation, no copy.
 */
function runWasmPtrFrame(world: WasmPtrWorld): void {
  const buf = world.view(); // fresh view (safe after memory.grow)
  const count = world.count;
  for (let i = 0; i < count; i++) {
    const base = i * FLAT_STRIDE;
    buf[base + 0] += buf[base + 2] * DT;
    buf[base + 1] += buf[base + 3] * DT;
  }
}

// ── World instances (built once, reused across bench iterations) ──────────────

const _ecs1k = buildWasmEcsWorld(1_000);
const _ecs5k = buildWasmEcsWorld(5_000);
const _ecs10k = buildWasmEcsWorld(10_000);

const _flat1k = buildFlatBufferWorld(1_000);
const _flat5k = buildFlatBufferWorld(5_000);
const _flat10k = buildFlatBufferWorld(10_000);

const _ptr1k = buildWasmPtrWorld(1_000);
const _ptr5k = buildWasmPtrWorld(5_000);
const _ptr10k = buildWasmPtrWorld(10_000);

// ── 1. Single frame — Path A ──────────────────────────────────────────────────

describe('Movement 1 frame — A: Chatty WASM ECS (3N crossings, current)', () => {
  bench('1 000 entities', () => runChattyWasmFrame(_ecs1k));
  bench('5 000 entities', () => runChattyWasmFrame(_ecs5k));
  bench('10 000 entities', () => runChattyWasmFrame(_ecs10k));
});

// ── 2. Single frame — Path B ──────────────────────────────────────────────────

describe('Movement 1 frame — B: Flat JS Float32Array (0 crossings, plugin owns data)', () => {
  bench('1 000 entities', () => runFlatBufferFrame(_flat1k));
  bench('5 000 entities', () => runFlatBufferFrame(_flat5k));
  bench('10 000 entities', () => runFlatBufferFrame(_flat10k));
});

// ── 3. Single frame — Path C ──────────────────────────────────────────────────

describe('Movement 1 frame — C: WASM linear memory (0 crossings, buffer in WASM heap)', () => {
  bench('1 000 entities', () => runWasmPtrFrame(_ptr1k));
  bench('5 000 entities', () => runWasmPtrFrame(_ptr5k));
  bench('10 000 entities', () => runWasmPtrFrame(_ptr10k));
});

// ── 4. Side-by-side — 1 000 entities, 1 frame ────────────────────────────────

const _sbsEcs = buildWasmEcsWorld(1_000);
const _sbsFlat = buildFlatBufferWorld(1_000);
const _sbsPtr = buildWasmPtrWorld(1_000);

describe('Side-by-side — 1 000 entities, 1 frame', () => {
  bench('A — Chatty WASM ECS     (3 000 crossings)', () => runChattyWasmFrame(_sbsEcs));
  bench('B — Flat JS Float32Array (0 crossings)   ', () => runFlatBufferFrame(_sbsFlat));
  bench('C — WASM linear memory   (0 crossings)   ', () => runWasmPtrFrame(_sbsPtr));
});

// ── 5. Sustained 100-frame simulation — 1 000 entities ───────────────────────

describe('Sustained 100 frames — 1 000 entities', () => {
  bench('A — Chatty WASM ECS', () => {
    const w = buildWasmEcsWorld(1_000);
    for (let f = 0; f < 100; f++) runChattyWasmFrame(w);
  });
  bench('B — Flat JS Float32Array', () => {
    const w = buildFlatBufferWorld(1_000);
    for (let f = 0; f < 100; f++) runFlatBufferFrame(w);
  });
  bench('C — WASM linear memory', () => {
    const w = buildWasmPtrWorld(1_000);
    for (let f = 0; f < 100; f++) runWasmPtrFrame(w);
  });
});

// ── 6. Sustained 100-frame simulation — 5 000 entities ───────────────────────

describe('Sustained 100 frames — 5 000 entities', () => {
  bench('A — Chatty WASM ECS', () => {
    const w = buildWasmEcsWorld(5_000);
    for (let f = 0; f < 100; f++) runChattyWasmFrame(w);
  });
  bench('B — Flat JS Float32Array', () => {
    const w = buildFlatBufferWorld(5_000);
    for (let f = 0; f < 100; f++) runFlatBufferFrame(w);
  });
  bench('C — WASM linear memory', () => {
    const w = buildWasmPtrWorld(5_000);
    for (let f = 0; f < 100; f++) runWasmPtrFrame(w);
  });
});

// ── Path D — Bulk WASM ECS API (target state) ─────────────────────────────────
//
// get_components_bulk / set_components_bulk collapse N JS↔WASM crossings into
// 3 per frame regardless of entity count:
//   1. query_entities  → slot indices
//   2. get_components_bulk(positions)
//   3. set_components_bulk(positions)   ← velocity is read-only each frame
//
// This is the direct replacement for Path A: same ECS storage, same component
// layout, but with the boundary-crossing count reduced from 3N → 3.

interface WasmEcsBulkWorld {
  engine: RawWasmEngine;
  posTypeId: number;
  velTypeId: number;
  /** Pre-allocated output buffer reused across frames. */
  posBuf: Uint8Array;
  /** Pre-allocated write buffer reused across frames. */
  writeBuf: Uint8Array;
  /** Velocity read buffer. */
  velBuf: Uint8Array;
}

function buildWasmEcsBulkWorld(n: number): WasmEcsBulkWorld {
  const { engine } = loadWasmEngine(n + 64);
  const posTypeId = engine.register_component_type();
  const velTypeId = engine.register_component_type();
  const posBuf = new Uint8Array(COMP_BYTES);
  const velBuf = new Uint8Array(COMP_BYTES);
  const archetype = new Uint32Array([posTypeId, velTypeId]);

  for (let i = 0; i < n; i++) {
    const eid = engine.create_entity();
    const dp = new DataView(posBuf.buffer);
    dp.setFloat32(0, i * 1.0, true);
    dp.setFloat32(4, 0.0, true);
    const dv = new DataView(velBuf.buffer);
    dv.setFloat32(0, 1.0, true);
    dv.setFloat32(4, 0.5, true);
    engine.add_component(eid.index, eid.generation, posTypeId, posBuf.slice());
    engine.add_component(eid.index, eid.generation, velTypeId, velBuf.slice());
    engine.update_entity_archetype(eid.index, archetype);
  }

  return {
    engine,
    posTypeId,
    velTypeId,
    posBuf: new Uint8Array(n * COMP_BYTES),
    writeBuf: new Uint8Array(n * COMP_BYTES),
    velBuf: new Uint8Array(n * COMP_BYTES),
  };
}

/**
 * Bulk implementation: 3 JS↔WASM crossings per frame, regardless of entity count.
 *
 *  Crossing 1 — query_entities  (get live slot indices)
 *  Crossing 2 — get_components_bulk positions
 *  Crossing 3 — get_components_bulk velocities
 *  Crossing 4 — set_components_bulk updated positions   (3 reads + 1 write = 4 total)
 *
 * All arithmetic runs entirely in JS on flat typed arrays — no per-entity WASM calls.
 */
function runBulkWasmFrame(world: WasmEcsBulkWorld): void {
  const { engine, posTypeId, velTypeId, posBuf, writeBuf, velBuf } = world;
  const slots = engine.query_entities(new Uint32Array([posTypeId, velTypeId]));
  const n = slots.length;
  if (n === 0) return;

  // All entities have generation 0 (never recycled in this bench).
  const gens = new Uint32Array(n); // all zeros

  // Bulk-read positions and velocities — 2 crossings.
  engine.get_components_bulk(slots, gens, posTypeId, posBuf);
  engine.get_components_bulk(slots, gens, velTypeId, velBuf);

  // Compute updated positions entirely in JS — 0 crossings.
  const posView = new DataView(posBuf.buffer);
  const velView = new DataView(velBuf.buffer);
  const outView = new DataView(writeBuf.buffer);
  for (let i = 0; i < n; i++) {
    const off = i * COMP_BYTES;
    const nx = posView.getFloat32(off, true) + velView.getFloat32(off, true) * DT;
    const ny = posView.getFloat32(off + 4, true) + velView.getFloat32(off + 4, true) * DT;
    outView.setFloat32(off, nx, true);
    outView.setFloat32(off + 4, ny, true);
  }

  // Bulk-write updated positions — 1 crossing.
  engine.set_components_bulk(slots, gens, posTypeId, writeBuf);
}

// ── World instances (built once) ──────────────────────────────────────────────

const _bulk1k = buildWasmEcsBulkWorld(1_000);
const _bulk5k = buildWasmEcsBulkWorld(5_000);
const _bulk10k = buildWasmEcsBulkWorld(10_000);

// ── 7. Single frame — Path D (Bulk API) ───────────────────────────────────────

describe('Movement 1 frame — D: Bulk WASM ECS API (4 crossings total, target state)', () => {
  bench('1 000 entities', () => runBulkWasmFrame(_bulk1k));
  bench('5 000 entities', () => runBulkWasmFrame(_bulk5k));
  bench('10 000 entities', () => runBulkWasmFrame(_bulk10k));
});

// ── 8. Side-by-side chatty vs bulk — 1 000 entities ──────────────────────────
//
// Directly answers: "how much faster is bulk vs chatty on 1k entities?"

const _sbsChatty2 = buildWasmEcsWorld(1_000);
const _sbsBulk2 = buildWasmEcsBulkWorld(1_000);

describe('Side-by-side chatty vs bulk — 1 000 entities, 1 frame', () => {
  bench('A — Chatty ECS (3 000 crossings)', () => runChattyWasmFrame(_sbsChatty2));
  bench('D — Bulk ECS   (4 crossings)    ', () => runBulkWasmFrame(_sbsBulk2));
});

// ── 9. Sustained 100-frame simulation — bulk API ──────────────────────────────

describe('Sustained 100 frames — D: Bulk WASM ECS API', () => {
  bench('1 000 entities', () => {
    const w = buildWasmEcsBulkWorld(1_000);
    for (let f = 0; f < 100; f++) runBulkWasmFrame(w);
  });
  bench('5 000 entities', () => {
    const w = buildWasmEcsBulkWorld(5_000);
    for (let f = 0; f < 100; f++) runBulkWasmFrame(w);
  });
});

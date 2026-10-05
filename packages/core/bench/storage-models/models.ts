/**
 * Bench-only storage models for ADR-0001.
 * Link: internals-docs/adr/0001-component-storage.md
 *
 * A, B and C keep every typed array on one WebAssembly.Memory.
 * `today` is a real engine, not a mock.
 */

import { createEngine, defineComponent, Types } from "../../src/index";
import type { EntityId, GwenEngine } from "../../src/index";
import { useQuery } from "../../src/system/index";

/** Entity counts of the reference scene. See ADR-0001. */
export const STORAGE_REFERENCE_SCENE = [1_000, 10_000] as const;

export const REFERENCE_FRAMES = 60;

/** f32 frame delta. Assignment into a Float32Array rounds the same way in A, B and C. */
export const DT = Math.fround(1 / 60);

const POS = 0b0001;
const VEL = 0b0010;
const HEALTH = 0b0100;
const ENEMY = 0b1000;

const PAGE = 65_536;

const MASKS = [POS | VEL, POS | VEL | ENEMY, POS | VEL | HEALTH, POS | VEL | HEALTH | ENEMY];

export const Position = defineComponent({
  name: "StorageBenchPosition",
  schema: { x: Types.f32, y: Types.f32 },
});

export const Velocity = defineComponent({
  name: "StorageBenchVelocity",
  schema: { vx: Types.f32, vy: Types.f32 },
});

export const Health = defineComponent({
  name: "StorageBenchHealth",
  schema: { current: Types.f32, max: Types.f32 },
});

export const Enemy = defineComponent({
  name: "StorageBenchEnemy",
  schema: {},
});

export function structuralOps(entityCount: number): number {
  return Math.floor(entityCount / 200);
}

export function removeEntity(entityCount: number, frame: number, k: number): number {
  const step = frame * structuralOps(entityCount) + k;
  return (step * 2) % entityCount;
}

export function addEntity(entityCount: number, frame: number, k: number): number {
  const step = frame * structuralOps(entityCount) + k;
  return (step * 2 + 1) % entityCount;
}

export interface StorageModel {
  readonly entityCount: number;
  movement(dt: number): void;
  regen(dt: number): void;
  addHealth(entity: number): void;
  removeHealth(entity: number): void;
  heapBytes(): number;
  position(entity: number): [number, number];
  velocity(entity: number): [number, number];
  health(entity: number): [number, number] | undefined;
  hasEnemy(entity: number): boolean;
}

export function runFrame(model: StorageModel, frame: number, dt = DT): void {
  model.movement(dt);
  model.regen(dt);
  const count = structuralOps(model.entityCount);
  for (let k = 0; k < count; k++) {
    model.removeHealth(removeEntity(model.entityCount, frame, k));
    model.addHealth(addEntity(model.entityCount, frame, k));
  }
}

function strideOf(mask: number): number {
  let count = 0;
  if (mask & POS) count += 2;
  if (mask & VEL) count += 2;
  if (mask & HEALTH) count += 2;
  return count;
}

function offsetsOf(mask: number): {
  px: number;
  py: number;
  vx: number;
  vy: number;
  hc: number;
  hm: number;
} {
  let cursor = 0;
  const none = -1;
  const offsets = { px: none, py: none, vx: none, vy: none, hc: none, hm: none };
  if (mask & POS) {
    offsets.px = cursor++;
    offsets.py = cursor++;
  }
  if (mask & VEL) {
    offsets.vx = cursor++;
    offsets.vy = cursor++;
  }
  if (mask & HEALTH) {
    offsets.hc = cursor++;
    offsets.hm = cursor++;
  }
  return offsets;
}

class SceneMemory {
  readonly memory: WebAssembly.Memory;
  readonly f32: Float32Array;
  readonly u32: Uint32Array;
  private cursor = 0;

  constructor(slots: number) {
    const pages = Math.max(1, Math.ceil((slots * 4) / PAGE));
    this.memory = new WebAssembly.Memory({ initial: pages });
    this.f32 = new Float32Array(this.memory.buffer);
    this.u32 = new Uint32Array(this.memory.buffer);
  }

  allocF32(count: number): Float32Array {
    const start = this.cursor;
    this.cursor += count;
    return this.f32.subarray(start, start + count);
  }

  allocU32(count: number): Uint32Array {
    const start = this.cursor;
    this.cursor += count;
    return this.u32.subarray(start, start + count);
  }

  heapBytes(): number {
    return this.memory.buffer.byteLength;
  }
}

function slotsForArchetypes(entityCount: number): number {
  let slots = entityCount * 2;
  for (const mask of MASKS) {
    slots += entityCount + strideOf(mask) * entityCount;
  }
  return slots;
}

interface PackedArch {
  mask: number;
  stride: number;
  count: number;
  data: Float32Array;
  entities: Uint32Array;
  offsets: ReturnType<typeof offsetsOf>;
}

interface Snap {
  pos: [number, number];
  vel: [number, number];
  health?: [number, number];
  enemy: boolean;
}

/** Strided packed rows on one WebAssembly.Memory. JS stand-in for A.direct. */
export class ModelA implements StorageModel {
  readonly entityCount: number;
  private readonly memory: SceneMemory;
  private readonly arches: PackedArch[] = [];
  private readonly locArch: Uint32Array;
  private readonly locRow: Uint32Array;

  constructor(entityCount: number) {
    this.entityCount = entityCount;
    this.memory = new SceneMemory(slotsForArchetypes(entityCount));
    this.locArch = this.memory.allocU32(entityCount);
    this.locRow = this.memory.allocU32(entityCount);
    for (const mask of MASKS) this.ensure(mask);
    for (let entity = 0; entity < entityCount; entity++) {
      let mask = POS | VEL;
      const health = entity % 2 === 0 ? ([entity, 100] as [number, number]) : undefined;
      if (health) mask |= HEALTH;
      const enemy = entity % 4 === 0;
      if (enemy) mask |= ENEMY;
      this.place(entity, mask, {
        pos: [entity, entity * 0.5],
        vel: [1, entity * 0.01],
        health,
        enemy,
      });
    }
  }

  movement(dt: number): void {
    for (const arch of this.arches) {
      if ((arch.mask & (POS | VEL)) !== (POS | VEL)) continue;
      const { px, py, vx, vy } = arch.offsets;
      const { data, stride, count } = arch;
      for (let row = 0; row < count; row++) {
        const base = row * stride;
        data[base + px] = (data[base + px] ?? 0) + (data[base + vx] ?? 0) * dt;
        data[base + py] = (data[base + py] ?? 0) + (data[base + vy] ?? 0) * dt;
      }
    }
  }

  regen(dt: number): void {
    for (const arch of this.arches) {
      if ((arch.mask & HEALTH) === 0) continue;
      const { hc } = arch.offsets;
      const { data, stride, count } = arch;
      for (let row = 0; row < count; row++) {
        const index = row * stride + hc;
        data[index] = (data[index] ?? 0) + dt;
      }
    }
  }

  addHealth(entity: number): void {
    const mask = this.maskAt(entity);
    if ((mask & HEALTH) !== 0) return;
    const snap = this.snapshot(entity);
    snap.health = [0, 100];
    this.migrate(entity, mask | HEALTH, snap);
  }

  removeHealth(entity: number): void {
    const mask = this.maskAt(entity);
    if ((mask & HEALTH) === 0) return;
    const snap = this.snapshot(entity);
    delete snap.health;
    this.migrate(entity, mask & ~HEALTH, snap);
  }

  heapBytes(): number {
    return this.memory.heapBytes();
  }

  position(entity: number): [number, number] {
    return this.pair(entity, "pos");
  }

  velocity(entity: number): [number, number] {
    return this.pair(entity, "vel");
  }

  health(entity: number): [number, number] | undefined {
    const arch = this.archAt(entity);
    if (!arch || (arch.mask & HEALTH) === 0) return undefined;
    const row = this.locRow[entity] ?? 0;
    const base = row * arch.stride;
    return [arch.data[base + arch.offsets.hc] ?? 0, arch.data[base + arch.offsets.hm] ?? 0];
  }

  hasEnemy(entity: number): boolean {
    const arch = this.archAt(entity);
    return arch !== undefined && (arch.mask & ENEMY) !== 0;
  }

  private ensure(mask: number): number {
    const found = this.arches.findIndex((arch) => arch.mask === mask);
    if (found >= 0) return found;
    const stride = strideOf(mask);
    const arch: PackedArch = {
      mask,
      stride,
      count: 0,
      data: this.memory.allocF32(this.entityCount * stride),
      entities: this.memory.allocU32(this.entityCount),
      offsets: offsetsOf(mask),
    };
    this.arches.push(arch);
    return this.arches.length - 1;
  }

  private archAt(entity: number): PackedArch | undefined {
    return this.arches[this.locArch[entity] ?? 0];
  }

  private maskAt(entity: number): number {
    return this.archAt(entity)?.mask ?? 0;
  }

  private snapshot(entity: number): Snap {
    const arch = this.archAt(entity);
    const row = this.locRow[entity] ?? 0;
    if (!arch) return { pos: [0, 0], vel: [0, 0], enemy: false };
    const base = row * arch.stride;
    const health =
      (arch.mask & HEALTH) !== 0
        ? ([arch.data[base + arch.offsets.hc] ?? 0, arch.data[base + arch.offsets.hm] ?? 0] as [
            number,
            number,
          ])
        : undefined;
    return {
      pos: [arch.data[base + arch.offsets.px] ?? 0, arch.data[base + arch.offsets.py] ?? 0],
      vel: [arch.data[base + arch.offsets.vx] ?? 0, arch.data[base + arch.offsets.vy] ?? 0],
      health,
      enemy: (arch.mask & ENEMY) !== 0,
    };
  }

  private place(entity: number, mask: number, snap: Snap): void {
    const index = this.ensure(mask);
    const arch = this.arches[index];
    if (!arch) return;
    const row = arch.count;
    arch.entities[row] = entity;
    const base = row * arch.stride;
    const fields: number[] = [];
    if (mask & POS) fields.push(snap.pos[0], snap.pos[1]);
    if (mask & VEL) fields.push(snap.vel[0], snap.vel[1]);
    if (mask & HEALTH && snap.health) fields.push(snap.health[0], snap.health[1]);
    for (let i = 0; i < fields.length; i++) arch.data[base + i] = fields[i] ?? 0;
    arch.count = row + 1;
    this.locArch[entity] = index;
    this.locRow[entity] = row;
  }

  private detach(index: number, row: number): void {
    const arch = this.arches[index];
    if (!arch || arch.count === 0) return;
    const last = arch.count - 1;
    if (row !== last) {
      const moved = arch.entities[last] ?? 0;
      arch.entities[row] = moved;
      const src = last * arch.stride;
      const dst = row * arch.stride;
      for (let i = 0; i < arch.stride; i++) arch.data[dst + i] = arch.data[src + i] ?? 0;
      this.locArch[moved] = index;
      this.locRow[moved] = row;
    }
    arch.count = last;
  }

  private migrate(entity: number, mask: number, snap: Snap): void {
    this.detach(this.locArch[entity] ?? 0, this.locRow[entity] ?? 0);
    this.place(entity, mask, snap);
  }

  private pair(entity: number, which: "pos" | "vel"): [number, number] {
    const arch = this.archAt(entity);
    if (!arch) return [0, 0];
    const base = (this.locRow[entity] ?? 0) * arch.stride;
    if (which === "pos") {
      return [arch.data[base + arch.offsets.px] ?? 0, arch.data[base + arch.offsets.py] ?? 0];
    }
    return [arch.data[base + arch.offsets.vx] ?? 0, arch.data[base + arch.offsets.vy] ?? 0];
  }
}

interface Sparse2 {
  sparse: Uint32Array;
  entities: Uint32Array;
  a: Float32Array;
  b: Float32Array;
  count: number;
}

interface Sparse0 {
  sparse: Uint32Array;
  entities: Uint32Array;
  count: number;
}

/** Dense per-field arrays plus a sparse slot. The second component is an indirect lookup. */
export class ModelB implements StorageModel {
  readonly entityCount: number;
  private readonly memory: SceneMemory;
  private readonly positionSet: Sparse2;
  private readonly velocitySet: Sparse2;
  private readonly healthSet: Sparse2;
  private readonly enemy: Sparse0;

  constructor(entityCount: number) {
    this.entityCount = entityCount;
    this.memory = new SceneMemory(14 * entityCount);
    this.positionSet = this.makeSparse2();
    this.velocitySet = this.makeSparse2();
    this.healthSet = this.makeSparse2();
    this.enemy = {
      sparse: this.memory.allocU32(entityCount),
      entities: this.memory.allocU32(entityCount),
      count: 0,
    };
    for (let entity = 0; entity < entityCount; entity++) {
      this.insert2(this.positionSet, entity, entity, entity * 0.5);
      this.insert2(this.velocitySet, entity, 1, entity * 0.01);
      if (entity % 2 === 0) this.insert2(this.healthSet, entity, entity, 100);
      if (entity % 4 === 0) this.insert0(this.enemy, entity);
    }
  }

  movement(dt: number): void {
    const rows = this.positionSet.count;
    for (let row = 0; row < rows; row++) {
      const entity = this.positionSet.entities[row] ?? 0;
      const slot = this.velocitySet.sparse[entity] ?? 0;
      if (slot === 0) continue;
      const dense = slot - 1;
      const vx = this.velocitySet.a[dense] ?? 0;
      const vy = this.velocitySet.b[dense] ?? 0;
      this.positionSet.a[row] = (this.positionSet.a[row] ?? 0) + vx * dt;
      this.positionSet.b[row] = (this.positionSet.b[row] ?? 0) + vy * dt;
    }
  }

  regen(dt: number): void {
    for (let row = 0; row < this.healthSet.count; row++) {
      this.healthSet.a[row] = (this.healthSet.a[row] ?? 0) + dt;
    }
  }

  addHealth(entity: number): void {
    if ((this.healthSet.sparse[entity] ?? 0) !== 0) return;
    this.insert2(this.healthSet, entity, 0, 100);
  }

  removeHealth(entity: number): void {
    this.remove2(this.healthSet, entity);
  }

  heapBytes(): number {
    return this.memory.heapBytes();
  }

  position(entity: number): [number, number] {
    return this.read2(this.positionSet, entity) ?? [0, 0];
  }

  velocity(entity: number): [number, number] {
    return this.read2(this.velocitySet, entity) ?? [0, 0];
  }

  health(entity: number): [number, number] | undefined {
    return this.read2(this.healthSet, entity);
  }

  hasEnemy(entity: number): boolean {
    return (this.enemy.sparse[entity] ?? 0) !== 0;
  }

  private makeSparse2(): Sparse2 {
    return {
      sparse: this.memory.allocU32(this.entityCount),
      entities: this.memory.allocU32(this.entityCount),
      a: this.memory.allocF32(this.entityCount),
      b: this.memory.allocF32(this.entityCount),
      count: 0,
    };
  }

  private insert2(set: Sparse2, entity: number, a: number, b: number): void {
    if ((set.sparse[entity] ?? 0) !== 0) {
      const dense = (set.sparse[entity] ?? 1) - 1;
      set.a[dense] = a;
      set.b[dense] = b;
      return;
    }
    const dense = set.count;
    set.entities[dense] = entity;
    set.a[dense] = a;
    set.b[dense] = b;
    set.sparse[entity] = dense + 1;
    set.count = dense + 1;
  }

  private remove2(set: Sparse2, entity: number): void {
    const slot = set.sparse[entity] ?? 0;
    if (slot === 0 || set.count === 0) return;
    const dense = slot - 1;
    const last = set.count - 1;
    if (dense !== last) {
      const moved = set.entities[last] ?? 0;
      set.entities[dense] = moved;
      set.a[dense] = set.a[last] ?? 0;
      set.b[dense] = set.b[last] ?? 0;
      set.sparse[moved] = slot;
    }
    set.sparse[entity] = 0;
    set.count = last;
  }

  private read2(set: Sparse2, entity: number): [number, number] | undefined {
    const slot = set.sparse[entity] ?? 0;
    if (slot === 0) return undefined;
    const dense = slot - 1;
    return [set.a[dense] ?? 0, set.b[dense] ?? 0];
  }

  private insert0(set: Sparse0, entity: number): void {
    if ((set.sparse[entity] ?? 0) !== 0) return;
    const dense = set.count;
    set.entities[dense] = entity;
    set.sparse[entity] = dense + 1;
    set.count = dense + 1;
  }
}

interface ChunkC {
  mask: number;
  count: number;
  entities: Uint32Array;
  px: Float32Array;
  py: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  hc: Float32Array;
  hm: Float32Array;
}

/** One Float32Array subarray per field per chunk. */
export class ModelC implements StorageModel {
  readonly entityCount: number;
  private readonly memory: SceneMemory;
  private readonly chunks: ChunkC[] = [];
  private readonly locArch: Uint32Array;
  private readonly locRow: Uint32Array;

  constructor(entityCount: number) {
    this.entityCount = entityCount;
    this.memory = new SceneMemory(slotsForArchetypes(entityCount));
    this.locArch = this.memory.allocU32(entityCount);
    this.locRow = this.memory.allocU32(entityCount);
    for (const mask of MASKS) this.ensure(mask);
    for (let entity = 0; entity < entityCount; entity++) {
      let mask = POS | VEL;
      const health = entity % 2 === 0 ? ([entity, 100] as [number, number]) : undefined;
      if (health) mask |= HEALTH;
      const enemy = entity % 4 === 0;
      if (enemy) mask |= ENEMY;
      this.place(entity, mask, {
        pos: [entity, entity * 0.5],
        vel: [1, entity * 0.01],
        health,
        enemy,
      });
    }
  }

  movement(dt: number): void {
    for (const chunk of this.chunks) {
      if ((chunk.mask & (POS | VEL)) !== (POS | VEL)) continue;
      for (let row = 0; row < chunk.count; row++) {
        const vx = chunk.vx[row] ?? 0;
        const vy = chunk.vy[row] ?? 0;
        chunk.px[row] = (chunk.px[row] ?? 0) + vx * dt;
        chunk.py[row] = (chunk.py[row] ?? 0) + vy * dt;
      }
    }
  }

  regen(dt: number): void {
    for (const chunk of this.chunks) {
      if ((chunk.mask & HEALTH) === 0) continue;
      for (let row = 0; row < chunk.count; row++) {
        chunk.hc[row] = (chunk.hc[row] ?? 0) + dt;
      }
    }
  }

  addHealth(entity: number): void {
    const mask = this.maskAt(entity);
    if ((mask & HEALTH) !== 0) return;
    const snap = this.snapshot(entity);
    snap.health = [0, 100];
    this.migrate(entity, mask | HEALTH, snap);
  }

  removeHealth(entity: number): void {
    const mask = this.maskAt(entity);
    if ((mask & HEALTH) === 0) return;
    const snap = this.snapshot(entity);
    delete snap.health;
    this.migrate(entity, mask & ~HEALTH, snap);
  }

  heapBytes(): number {
    return this.memory.heapBytes();
  }

  position(entity: number): [number, number] {
    const chunk = this.chunkAt(entity);
    const row = this.locRow[entity] ?? 0;
    if (!chunk) return [0, 0];
    return [chunk.px[row] ?? 0, chunk.py[row] ?? 0];
  }

  velocity(entity: number): [number, number] {
    const chunk = this.chunkAt(entity);
    const row = this.locRow[entity] ?? 0;
    if (!chunk) return [0, 0];
    return [chunk.vx[row] ?? 0, chunk.vy[row] ?? 0];
  }

  health(entity: number): [number, number] | undefined {
    const chunk = this.chunkAt(entity);
    if (!chunk || (chunk.mask & HEALTH) === 0) return undefined;
    const row = this.locRow[entity] ?? 0;
    return [chunk.hc[row] ?? 0, chunk.hm[row] ?? 0];
  }

  hasEnemy(entity: number): boolean {
    const chunk = this.chunkAt(entity);
    return chunk !== undefined && (chunk.mask & ENEMY) !== 0;
  }

  private ensure(mask: number): number {
    const found = this.chunks.findIndex((chunk) => chunk.mask === mask);
    if (found >= 0) return found;
    const has = (bit: number) => (mask & bit) !== 0;
    const chunk: ChunkC = {
      mask,
      count: 0,
      entities: this.memory.allocU32(this.entityCount),
      px: this.memory.allocF32(has(POS) ? this.entityCount : 0),
      py: this.memory.allocF32(has(POS) ? this.entityCount : 0),
      vx: this.memory.allocF32(has(VEL) ? this.entityCount : 0),
      vy: this.memory.allocF32(has(VEL) ? this.entityCount : 0),
      hc: this.memory.allocF32(has(HEALTH) ? this.entityCount : 0),
      hm: this.memory.allocF32(has(HEALTH) ? this.entityCount : 0),
    };
    this.chunks.push(chunk);
    return this.chunks.length - 1;
  }

  private chunkAt(entity: number): ChunkC | undefined {
    return this.chunks[this.locArch[entity] ?? 0];
  }

  private maskAt(entity: number): number {
    return this.chunkAt(entity)?.mask ?? 0;
  }

  private snapshot(entity: number): Snap {
    const chunk = this.chunkAt(entity);
    const row = this.locRow[entity] ?? 0;
    if (!chunk) return { pos: [0, 0], vel: [0, 0], enemy: false };
    const health =
      (chunk.mask & HEALTH) !== 0
        ? ([chunk.hc[row] ?? 0, chunk.hm[row] ?? 0] as [number, number])
        : undefined;
    return {
      pos: [chunk.px[row] ?? 0, chunk.py[row] ?? 0],
      vel: [chunk.vx[row] ?? 0, chunk.vy[row] ?? 0],
      health,
      enemy: (chunk.mask & ENEMY) !== 0,
    };
  }

  private place(entity: number, mask: number, snap: Snap): void {
    const index = this.ensure(mask);
    const chunk = this.chunks[index];
    if (!chunk) return;
    const row = chunk.count;
    chunk.entities[row] = entity;
    if (mask & POS) {
      chunk.px[row] = snap.pos[0];
      chunk.py[row] = snap.pos[1];
    }
    if (mask & VEL) {
      chunk.vx[row] = snap.vel[0];
      chunk.vy[row] = snap.vel[1];
    }
    if (mask & HEALTH && snap.health) {
      chunk.hc[row] = snap.health[0];
      chunk.hm[row] = snap.health[1];
    }
    chunk.count = row + 1;
    this.locArch[entity] = index;
    this.locRow[entity] = row;
  }

  private detach(index: number, row: number): void {
    const chunk = this.chunks[index];
    if (!chunk || chunk.count === 0) return;
    const last = chunk.count - 1;
    if (row !== last) {
      const moved = chunk.entities[last] ?? 0;
      chunk.entities[row] = moved;
      const swap = (values: Float32Array) => {
        if (values.length === 0) return;
        values[row] = values[last] ?? 0;
      };
      if (chunk.mask & POS) {
        swap(chunk.px);
        swap(chunk.py);
      }
      if (chunk.mask & VEL) {
        swap(chunk.vx);
        swap(chunk.vy);
      }
      if (chunk.mask & HEALTH) {
        swap(chunk.hc);
        swap(chunk.hm);
      }
      this.locArch[moved] = index;
      this.locRow[moved] = row;
    }
    chunk.count = last;
  }

  private migrate(entity: number, mask: number, snap: Snap): void {
    this.detach(this.locArch[entity] ?? 0, this.locRow[entity] ?? 0);
    this.place(entity, mask, snap);
  }
}

/** Real `createEngine` + `useQuery` + `e.get()`. Not a mock. */
export class TodayModel implements StorageModel {
  readonly entityCount: number;
  private readonly engine: GwenEngine;
  private readonly ids: EntityId[];
  private readonly movementQuery: ReturnType<typeof useQuery>;
  private readonly healthQuery: ReturnType<typeof useQuery>;
  private readonly bytes: number;
  private stopped = false;

  private constructor(
    engine: GwenEngine,
    ids: EntityId[],
    movementQuery: ReturnType<typeof useQuery>,
    healthQuery: ReturnType<typeof useQuery>,
    bytes: number,
  ) {
    this.engine = engine;
    this.ids = ids;
    this.entityCount = ids.length;
    this.movementQuery = movementQuery;
    this.healthQuery = healthQuery;
    this.bytes = bytes;
  }

  static async build(entityCount: number): Promise<TodayModel> {
    const engine = await createEngine({ maxEntities: entityCount, variant: "light" });
    try {
      const gc = (globalThis as { gc?: () => void }).gc;
      gc?.();
      const before = process.memoryUsage().heapUsed;
      const ids: EntityId[] = [];
      for (let entity = 0; entity < entityCount; entity++) {
        const id = engine.createEntity();
        ids.push(id);
        engine.addComponent(id, Position, { x: entity, y: entity * 0.5 });
        engine.addComponent(id, Velocity, { vx: 1, vy: entity * 0.01 });
        if (entity % 2 === 0) {
          engine.addComponent(id, Health, { current: entity, max: 100 });
        }
        if (entity % 4 === 0) engine.addComponent(id, Enemy, {});
      }
      gc?.();
      const bytes = Math.max(0, process.memoryUsage().heapUsed - before);
      const movementQuery = engine.run(() => useQuery([Position, Velocity]));
      const healthQuery = engine.run(() => useQuery([Health]));
      return new TodayModel(engine, ids, movementQuery, healthQuery, bytes);
    } catch (error) {
      await engine.stop();
      throw error;
    }
  }

  movement(dt: number): void {
    for (const entity of this.movementQuery) {
      const pos = entity.get(Position);
      const vel = entity.get(Velocity);
      if (pos === undefined || vel === undefined) continue;
      pos.x += vel.vx * dt;
      pos.y += vel.vy * dt;
    }
  }

  regen(dt: number): void {
    for (const entity of this.healthQuery) {
      const health = entity.get(Health);
      if (health === undefined) continue;
      health.current += dt;
    }
  }

  addHealth(entity: number): void {
    const id = this.ids[entity];
    if (id === undefined || this.engine.hasComponent(id, Health)) return;
    this.engine.addComponent(id, Health, { current: 0, max: 100 });
  }

  removeHealth(entity: number): void {
    const id = this.ids[entity];
    if (id === undefined) return;
    this.engine.removeComponent(id, Health);
  }

  heapBytes(): number {
    return this.bytes;
  }

  position(entity: number): [number, number] {
    const id = this.ids[entity];
    const pos = id === undefined ? undefined : this.engine.getComponent(id, Position);
    return [pos?.x ?? 0, pos?.y ?? 0];
  }

  velocity(entity: number): [number, number] {
    const id = this.ids[entity];
    const vel = id === undefined ? undefined : this.engine.getComponent(id, Velocity);
    return [vel?.vx ?? 0, vel?.vy ?? 0];
  }

  health(entity: number): [number, number] | undefined {
    const id = this.ids[entity];
    const health = id === undefined ? undefined : this.engine.getComponent(id, Health);
    if (health === undefined) return undefined;
    return [health.current, health.max];
  }

  hasEnemy(entity: number): boolean {
    const id = this.ids[entity];
    if (id === undefined) return false;
    return this.engine.hasComponent(id, Enemy);
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    await this.engine.stop();
  }
}

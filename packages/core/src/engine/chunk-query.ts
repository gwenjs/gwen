import { GwenError } from "@gwenjs/schema";

import type { ComponentDef, EntityAccessor, LiveQuery } from "../system/runtime/define-system.js";
import type { ComponentSchema, SchemaType } from "../schema.js";
import { createEntityId, type EntityId } from "../types/entity.js";
import type { GwenEngine } from "./engine-types.js";
import { CoreErrorCodes } from "./engine-errors.js";
import { componentRegistryFor } from "./engine-component-registry.js";
import { chunkLaneViews, type LaneArray, type ViewableLaneKind } from "./chunk-lanes.js";
import type { WasmBridgeImpl } from "./wasm-bridge.js";

/**
 * Column views for one component in one chunk.
 * String, i64, and u64 fields are absent: reading them is a type error.
 */
export type ChunkColumns<D> = {
  [K in keyof SchemaOf<D> as ColumnOf<SchemaOf<D>[K]> extends never ? never : K]: ColumnOf<
    SchemaOf<D>[K]
  >;
};

type SchemaOf<D> = D extends { readonly schema: infer S } ? S : never;

type Vec2Cols = { readonly x: Float32Array; readonly y: Float32Array };
type Vec3Cols = { readonly x: Float32Array; readonly y: Float32Array; readonly z: Float32Array };
type Vec4Cols = {
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly z: Float32Array;
  readonly w: Float32Array;
};
type ColorCols = {
  readonly r: Float32Array;
  readonly g: Float32Array;
  readonly b: Float32Array;
  readonly a: Float32Array;
};

type ColumnOf<T> = T extends { readonly type: "f32" }
  ? Float32Array
  : T extends { readonly type: "f64" }
    ? Float64Array
    : T extends { readonly type: "i32" }
      ? Int32Array
      : T extends { readonly type: "u32" }
        ? Uint32Array
        : T extends { readonly type: "bool" }
          ? Uint8Array
          : T extends { readonly type: "vec2" }
            ? Vec2Cols
            : T extends { readonly type: "vec3" }
              ? Vec3Cols
              : T extends { readonly type: "vec4" }
                ? Vec4Cols
                : T extends { readonly type: "quat" }
                  ? Vec4Cols
                  : T extends { readonly type: "color" }
                    ? ColorCols
                    : never;

/** One matching archetype chunk. Valid until the iterator steps past it. */
export interface QueryChunk<Defs extends readonly ComponentDef[]> {
  readonly count: number;
  get<D extends Defs[number]>(def: D): ChunkColumns<D>;
  entityId(row: number): EntityId;
}

/** Chunk iteration over the entities that have every def. */
export interface Query<Defs extends readonly ComponentDef[]> {
  readonly count: number;
  [Symbol.iterator](): Iterator<QueryChunk<Defs>>;
  each(): LiveQuery<EntityAccessor<Defs>>;
}

interface FieldPlan {
  readonly key: string;
  readonly parts: readonly string[];
}

interface DefPlan {
  readonly fields: readonly FieldPlan[];
  readonly laneStart: number;
  readonly laneCount: number;
}

interface QueryBridge {
  isActive(): boolean;
  registerQuery(typeIds: Uint32Array): number;
  queryChunks(query: number): number;
  releaseQuery(query: number): void;
}

const INVALID = "Query is invalid";

const releases = new WeakMap<object, () => void>();

/** Drop the wasm handle. A second call does nothing. */
export function releaseChunkQuery(query: object): void {
  releases.get(query)?.();
}

export function createChunkQuery<const C extends readonly ComponentDef[]>(
  engine: GwenEngine,
  bridge: WasmBridgeImpl,
  components: C,
  each: () => LiveQuery<EntityAccessor<C>>,
): Query<C> {
  const query = new ChunkQuery(engine, bridge, components, each);
  releases.set(query, () => {
    query.release();
  });
  return query;
}

function partsFor(type: SchemaType["type"]): readonly string[] | null {
  switch (type) {
    case "f32":
    case "f64":
    case "i32":
    case "u32":
    case "bool":
      return SCALAR;
    case "vec2":
      return VEC2;
    case "vec3":
      return VEC3;
    case "vec4":
    case "quat":
      return VEC4;
    case "color":
      return COLOR;
    case "i64":
    case "u64":
    case "string":
      return null;
    default: {
      const unexpected: never = type;
      throw new GwenError(
        CoreErrorCodes.COMPONENT_LAYOUT_INVALID,
        `Component layout invalid: ${String(unexpected)}`,
      );
    }
  }
}

const SCALAR: readonly string[] = ["scalar"];
const VEC2: readonly string[] = ["x", "y"];
const VEC3: readonly string[] = ["x", "y", "z"];
const VEC4: readonly string[] = ["x", "y", "z", "w"];
const COLOR: readonly string[] = ["r", "g", "b", "a"];

function kindFor(type: SchemaType["type"]): ViewableLaneKind | null {
  switch (type) {
    case "f32":
    case "vec2":
    case "vec3":
    case "vec4":
    case "quat":
    case "color":
      return 0;
    case "f64":
      return 1;
    case "i32":
      return 2;
    case "u32":
      return 3;
    case "bool":
      return 4;
    case "i64":
    case "u64":
    case "string":
      return null;
    default: {
      const unexpected: never = type;
      throw new GwenError(
        CoreErrorCodes.COMPONENT_LAYOUT_INVALID,
        `Component layout invalid: ${String(unexpected)}`,
      );
    }
  }
}

function planQuery(components: readonly ComponentDef[]): {
  plans: DefPlan[];
  kinds: ViewableLaneKind[];
} {
  const plans: DefPlan[] = [];
  const kinds: ViewableLaneKind[] = [];
  for (let defIndex = 0; defIndex < components.length; defIndex += 1) {
    const def = components[defIndex];
    if (def === undefined) continue;
    const fields: FieldPlan[] = [];
    const laneStart = kinds.length;
    const schema: ComponentSchema = def.schema;
    for (const key of Object.keys(schema)) {
      const field = schema[key];
      if (!field) {
        throw new GwenError(
          CoreErrorCodes.COMPONENT_LAYOUT_INVALID,
          `Component layout invalid: ${key}`,
        );
      }
      const parts = partsFor(field.type);
      const kind = kindFor(field.type);
      if (parts === null || kind === null) continue;
      fields.push({ key, parts });
      for (let part = 0; part < parts.length; part += 1) kinds.push(kind);
    }
    plans.push({ fields, laneStart, laneCount: kinds.length - laneStart });
  }
  return { plans, kinds };
}

class ChunkCursor<C extends readonly ComponentDef[]> implements QueryChunk<C> {
  count = 0;
  private stale = true;
  private indexPtr = 0;
  private generationPtr = 0;
  private viewIndex = 0;
  private readonly columns: unknown[] = [];
  private readonly columnLanes: (readonly LaneArray[])[] = [];

  constructor(
    private readonly owner: ChunkQuery<C>,
    private readonly plans: readonly DefPlan[],
    private readonly components: C,
  ) {}

  close(): void {
    this.stale = true;
  }

  bind(viewIndex: number, count: number, indexPtr: number, generationPtr: number): void {
    this.stale = false;
    this.viewIndex = viewIndex;
    this.count = count;
    this.indexPtr = indexPtr;
    this.generationPtr = generationPtr;
  }

  get<D extends C[number]>(def: D): ChunkColumns<D> {
    this.guard();
    const defIndex = this.components.indexOf(def);
    const plan = defIndex < 0 ? undefined : this.plans[defIndex];
    if (plan === undefined) throw new GwenError(CoreErrorCodes.QUERY_INVALID, INVALID);
    const view = this.owner.viewAt(this.viewIndex);
    const lanes = view.lanes;
    const cached = this.columnLanes[defIndex];
    const record = this.columns[defIndex];
    if (record !== undefined && cached !== undefined && sameLaneSlice(cached, lanes, plan)) {
      return record as ChunkColumns<D>;
    }
    const built = buildColumns(plan, lanes);
    const slice: LaneArray[] = [];
    for (let lane = 0; lane < plan.laneCount; lane += 1) {
      const array = lanes[plan.laneStart + lane];
      if (array !== undefined) slice.push(array);
    }
    this.columnLanes[defIndex] = slice;
    this.columns[defIndex] = built;
    return built as ChunkColumns<D>;
  }

  entityId = (row: number): EntityId => {
    this.guard();
    if (row < 0 || row >= this.count) throw new GwenError(CoreErrorCodes.QUERY_INVALID, INVALID);
    const memory = this.owner.buffer();
    const indexes = new Uint32Array(memory, this.indexPtr, this.count);
    const generations = new Uint32Array(memory, this.generationPtr, this.count);
    return createEntityId(indexes[row] ?? 0, generations[row] ?? 0);
  };

  private guard(): void {
    if (this.stale || this.owner.released) {
      throw new GwenError(CoreErrorCodes.QUERY_INVALID, INVALID);
    }
  }
}

function sameLaneSlice(
  cached: readonly LaneArray[],
  lanes: readonly LaneArray[],
  plan: DefPlan,
): boolean {
  if (cached.length !== plan.laneCount) return false;
  for (let lane = 0; lane < plan.laneCount; lane += 1) {
    if (cached[lane] !== lanes[plan.laneStart + lane]) return false;
  }
  return true;
}

function buildColumns(plan: DefPlan, lanes: readonly LaneArray[]): Record<string, unknown> {
  const columns: Record<string, unknown> = {};
  let cursor = plan.laneStart;
  for (let fieldIndex = 0; fieldIndex < plan.fields.length; fieldIndex += 1) {
    const field = plan.fields[fieldIndex];
    if (field === undefined) continue;
    if (field.parts.length === 1 && field.parts[0] === "scalar") {
      columns[field.key] = lanes[cursor];
      cursor += 1;
      continue;
    }
    const group: Record<string, LaneArray | undefined> = {};
    for (let part = 0; part < field.parts.length; part += 1) {
      const name = field.parts[part];
      if (name === undefined) continue;
      group[name] = lanes[cursor];
      cursor += 1;
    }
    columns[field.key] = group;
  }
  return columns;
}

class ChunkIter<C extends readonly ComponentDef[]> implements Iterator<QueryChunk<C>> {
  private position = -1;
  private chunkCount = 0;
  private running = false;
  private stride = 0;
  private readonly tableWords: number[] = [];
  /** Yield and return stay as two objects: `IteratorResult` is a union of distinct shapes. */
  private readonly yielded: IteratorYieldResult<QueryChunk<C>>;
  private readonly finished: IteratorReturnResult<undefined> = { done: true, value: undefined };

  constructor(
    private readonly owner: ChunkQuery<C>,
    private readonly chunk: ChunkCursor<C>,
  ) {
    this.yielded = { done: false, value: chunk };
  }

  get isRunning(): boolean {
    return this.running;
  }

  reset(): void {
    this.position = -1;
    this.chunkCount = 0;
    this.running = true;
    this.chunk.close();
  }

  next(): IteratorResult<QueryChunk<C>, undefined> {
    if (this.owner.released) throw new GwenError(CoreErrorCodes.QUERY_INVALID, INVALID);
    if (this.position < 0) {
      this.load();
      this.position = 0;
    } else {
      this.chunk.close();
    }
    if (this.position >= this.chunkCount) {
      this.running = false;
      this.chunk.close();
      return this.finished;
    }
    const base = this.position * 4;
    this.chunk.bind(
      this.position,
      this.tableWords[base + 1] ?? 0,
      this.tableWords[base + 2] ?? 0,
      this.tableWords[base + 3] ?? 0,
    );
    this.position += 1;
    return this.yielded;
  }

  return(): IteratorResult<QueryChunk<C>, undefined> {
    this.running = false;
    this.chunk.close();
    return this.finished;
  }

  private load(): void {
    const ptr = this.owner.readTable();
    if (ptr === 0) {
      this.chunkCount = 0;
      return;
    }
    const memory = this.owner.buffer();
    const header = new Uint32Array(memory, ptr, 4);
    this.chunkCount = header[0] ?? 0;
    this.stride = header[2] ?? 0;
    const words = this.tableWords;
    words.length = this.chunkCount * 4;
    if (this.chunkCount === 0 || this.stride < 4) {
      this.chunkCount = 0;
      return;
    }
    const table = new Uint32Array(memory, ptr, 4 + this.chunkCount * this.stride);
    for (let index = 0; index < this.chunkCount; index += 1) {
      const src = 4 + index * this.stride;
      const dest = index * 4;
      words[dest] = table[src] ?? 0;
      words[dest + 1] = table[src + 1] ?? 0;
      words[dest + 2] = table[src + 2] ?? 0;
      words[dest + 3] = table[src + 3] ?? 0;
    }
  }
}

class ChunkQuery<C extends readonly ComponentDef[]> implements Query<C> {
  released = false;
  private handle: number | null = null;
  private readonly plans: readonly DefPlan[];
  private readonly kinds: readonly ViewableLaneKind[];
  private readonly components: C;
  private readonly primary: ChunkIter<C>;
  private tablePtr = 0;

  constructor(
    private readonly engine: GwenEngine,
    private readonly bridge: QueryBridge,
    components: C,
    private readonly readEach: () => LiveQuery<EntityAccessor<C>>,
  ) {
    this.components = components;
    const planned = planQuery(components);
    this.plans = planned.plans;
    this.kinds = planned.kinds;
    if (components.length > 0) {
      const registry = componentRegistryFor(engine);
      const ids = new Uint32Array(components.length);
      for (let index = 0; index < components.length; index += 1) {
        const def = components[index];
        if (def === undefined) continue;
        ids[index] = registry.getOrRegister(def);
      }
      this.handle = bridge.registerQuery(ids);
    }
    this.primary = new ChunkIter(this, new ChunkCursor(this, this.plans, components));
  }

  get count(): number {
    if (this.released) throw new GwenError(CoreErrorCodes.QUERY_INVALID, INVALID);
    if (this.handle === null) return 0;
    const ptr = this.readTable();
    const header = new Uint32Array(this.buffer(), ptr, 4);
    return header[3] ?? 0;
  }

  readonly each = (): LiveQuery<EntityAccessor<C>> => {
    if (this.released) throw new GwenError(CoreErrorCodes.QUERY_INVALID, INVALID);
    return this.readEach();
  };

  [Symbol.iterator](): Iterator<QueryChunk<C>> {
    if (this.released) throw new GwenError(CoreErrorCodes.QUERY_INVALID, INVALID);
    if (this.primary.isRunning) {
      const nested = new ChunkIter(this, new ChunkCursor(this, this.plans, this.components));
      nested.reset();
      return nested;
    }
    this.primary.reset();
    return this.primary;
  }

  release(): void {
    if (this.released) return;
    this.released = true;
    const handle = this.handle;
    this.handle = null;
    if (handle !== null && this.bridge.isActive()) this.bridge.releaseQuery(handle);
  }

  readTable(): number {
    if (this.released) throw new GwenError(CoreErrorCodes.QUERY_INVALID, INVALID);
    if (this.handle === null) return 0;
    const ptr = this.bridge.queryChunks(this.handle);
    if (ptr <= 0) throw new GwenError(CoreErrorCodes.QUERY_INVALID, INVALID);
    this.tablePtr = ptr;
    return ptr;
  }

  viewAt(index: number): { readonly lanes: readonly LaneArray[] } {
    const views = chunkLaneViews(this.engine, this.tablePtr, this.kinds);
    const view = views[index];
    if (view === undefined) throw new GwenError(CoreErrorCodes.QUERY_INVALID, INVALID);
    return view;
  }

  buffer(): ArrayBufferLike {
    const memory = this.engine.memory.linearMemory();
    if (memory === null) throw new GwenError(CoreErrorCodes.QUERY_INVALID, INVALID);
    return memory.buffer;
  }
}

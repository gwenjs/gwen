import {
  computeSchemaLayout,
  type ComponentDefinition,
  type ComponentSchema,
  type InferComponent,
  type SchemaLayout,
} from "../schema.js";
import { createEntityId, entityGeneration, entityIndex, type EntityId } from "../types/entity.js";
import type { ComponentDef, EntityAccessor, LiveQuery } from "../system/runtime/define-system.js";
import { createChunkQuery, releaseChunkQuery, type Query } from "./chunk-query.js";
import { EntityIdMirror } from "./entity-id-mirror.js";
import { bindEntityTrace } from "./entity-trace.js";
import type { GwenEngine } from "./engine-types.js";
import { componentRegistryFor } from "./engine-component-registry.js";
import { componentStaging } from "./chunk-lanes.js";
import type { WasmBridgeImpl } from "./wasm-bridge.js";
import { stringPoolFor } from "../utils/string-pool.js";

/**
 * `createEntity`, `addComponent`, `removeComponent`, and `destroyEntity` call
 * `assertState` before they change storage. The facade passes `_assertNotFaulted`.
 * `emitDestroy` is the facade's entity:destroy fan-out.
 */
export interface EngineEntitiesDeps {
  maxEntities: number;
  assertState: (method: string) => void;
  emitDestroy: (id: EntityId) => void;
  engine: GwenEngine;
  bridge: WasmBridgeImpl;
}

interface StoredLayout {
  layout: SchemaLayout<Record<string, unknown>>;
  scratch: Record<string, unknown>;
}

interface IdCache {
  ids: EntityId[];
  membership: number;
}

/** One wasm query and the id array refilled when storage generation changes. */
interface MemberCache {
  ids: EntityId[];
  generation: number;
  query: number;
}

const OP_CREATE = 1;
const OP_DESTROY = 2;
const OP_ADD = 3;
const OP_REMOVE = 4;
const OP_DORMANT = 5;

function readResolvedEntityId(results: readonly EntityId[], index: number): EntityId {
  return results[index] as EntityId; // boundary: dense query id list, index checked #77
}

function freezeSnapshot<T>(value: T): Readonly<T> {
  if (__GWEN_DEV__) {
    freezeValue(value);
  }
  return value;
}

function freezeValue(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  if (Object.isFrozen(value)) return;
  Object.freeze(value);
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) freezeValue(record[key]);
}

/**
 * Entity ids, component rows, and live queries for one engine.
 * Rows live in the WASM chunk store. `getComponent` returns a snapshot.
 * @internal
 */
export class EngineEntities {
  private readonly layouts = new Map<string, StoredLayout>();
  private readonly idLists = new Map<string, IdCache>();
  /** Component queries. Empty type lists stay in `idLists`. */
  private readonly memberLists = new Map<string, MemberCache>();
  /** Chunk queries released on `engine:stop`. */
  private readonly chunkQueries: object[] = [];
  /** Bumps on a cold add, a remove, or a destroy. Dormancy does not bump it. */
  private membership = 0;
  /** Bumps when an entity is created or destroyed. Component queries ignore it. */
  private aliveEpoch = 0;
  /** One past the highest slot index this engine has allocated. */
  private slotSpan = 0;
  /** Open chunk loops on this engine. Structural ops queue while this is above 0. */
  private depth = 0;
  private readonly mirror: EntityIdMirror;
  private readonly loopHooks = {
    enter: (): void => {
      this.enterLoop();
    },
    leave: (): void => {
      this.leaveLoop();
    },
  };
  private opCapacity = 0;
  private opCount = 0;
  private opKinds = new Uint8Array(0);
  private opIndexes = new Uint32Array(0);
  private opGenerations = new Uint32Array(0);
  private opTypes = new Uint32Array(0);
  private opFlags = new Uint8Array(0);
  private addDefs: (ComponentDefinition<ComponentSchema> | null)[] = [];
  private addData: (object | null)[] = [];
  /** Component rows in the simulated state. Index is the entity slot. */
  private rowCounts = new Uint16Array(0);

  private readonly readStagingPtr = (): number => this.deps.bridge.componentStagingPtr();

  constructor(private readonly deps: EngineEntitiesDeps) {
    this.mirror = new EntityIdMirror(deps.maxEntities);
    bindEntityTrace(deps.bridge, {
      allocated: (index, generation) => {
        this.mirror.noteAllocated(index, generation);
      },
      deallocated: (index, generation) => {
        this.mirror.noteDeallocated(index, generation);
      },
    });
  }

  /** Alive entity ids. `getStats().entityCount` reads this. */
  count(): number {
    return this.deps.bridge.countEntities();
  }

  /**
   * Create a new entity.
   * @returns A fresh {@link EntityId}.
   * @throws {GwenError} code `CORE:ENTITY_LIMIT_REACHED` when the entity capacity is exceeded.
   */
  createEntity(): EntityId {
    this.deps.assertState("createEntity");
    if (this.depth === 0) return this.createNow();
    const reserved = this.mirror.tryAllocate();
    if (reserved === null) return this.createNow();
    if (reserved.index >= this.slotSpan) this.slotSpan = reserved.index + 1;
    this.pushOp(OP_CREATE, reserved.index, reserved.generation, 0, 0);
    return createEntityId(reserved.index, reserved.generation);
  }

  /** WASM spawn. Used outside a chunk loop, and when the mirror is already full. */
  private createNow(): EntityId {
    const created = this.deps.bridge.createEntity();
    if (created.index >= this.slotSpan) this.slotSpan = created.index + 1;
    this.aliveEpoch += 1;
    return createEntityId(created.index, created.generation);
  }

  canSpawn(count: number): boolean {
    return count <= this.deps.maxEntities - this.deps.bridge.countEntities();
  }

  /**
   * Destroy an entity and remove all its components.
   *
   * @param id - The entity to destroy
   * @returns `true` if it was alive and is now destroyed
   */
  destroyEntity(id: EntityId): boolean {
    this.deps.assertState("destroyEntity");
    const index = entityIndex(id);
    const generation = entityGeneration(id);
    if (this.depth === 0) return this.destroyNow(id, index, generation);
    if (!this.mirror.deallocate(index, generation)) return false;
    this.clearRows(index);
    this.pushOp(OP_DESTROY, index, generation, 0, 0);
    return true;
  }

  private destroyNow(id: EntityId, index: number, generation: number): boolean {
    if (!this.deps.bridge.deleteEntity(index, generation)) return false;
    this.clearRows(index);
    this.membership += 1;
    this.aliveEpoch += 1;
    this.deps.emitDestroy(id);
    return true;
  }

  private enterLoop(): void {
    this.depth += 1;
  }

  /**
   * The outermost loop flushes. Depth stays above 0 for the whole flush so a
   * destroy hook that spawns or destroys queues behind the op that fired it.
   */
  private leaveLoop(): void {
    if (this.depth === 0) return;
    this.depth -= 1;
    if (this.depth > 0) return;
    this.depth = 1;
    try {
      this.flush();
    } finally {
      this.clearOps();
      this.depth = 0;
    }
  }

  private flush(): void {
    let cursor = 0;
    while (cursor < this.opCount) {
      const kind = this.opKinds[cursor] ?? 0;
      const index = this.opIndexes[cursor] ?? 0;
      const generation = this.opGenerations[cursor] ?? 0;
      const typeId = this.opTypes[cursor] ?? 0;
      const flag = this.opFlags[cursor] ?? 0;
      const slot = cursor;
      cursor += 1;
      if (kind === OP_CREATE) this.applyCreate();
      else if (kind === OP_DESTROY) this.applyDestroy(index, generation);
      else if (kind === OP_ADD) this.applyAdd(slot, index, generation, typeId);
      else if (kind === OP_REMOVE) this.applyRemove(index, generation, typeId);
      else if (kind === OP_DORMANT) this.applyDormant(index, generation, flag === 1);
    }
  }

  private applyCreate(): void {
    const created = this.deps.bridge.createEntity();
    if (created.index >= this.slotSpan) this.slotSpan = created.index + 1;
    this.aliveEpoch += 1;
  }

  private applyDestroy(index: number, generation: number): void {
    if (!this.deps.bridge.deleteEntity(index, generation)) return;
    this.membership += 1;
    this.aliveEpoch += 1;
    this.deps.emitDestroy(createEntityId(index, generation));
  }

  private applyAdd(slot: number, index: number, generation: number, typeId: number): void {
    const def = this.addDefs[slot];
    const data = this.addData[slot];
    if (def === undefined || def === null || data === undefined || data === null) return;
    if (this.deps.bridge.hasComponent(index, generation, typeId)) {
      this.writePresent(def, data, index, generation, typeId);
      return;
    }
    if (this.writeCold(def, data, index, generation, typeId)) this.membership += 1;
  }

  private applyRemove(index: number, generation: number, typeId: number): void {
    if (this.deps.bridge.removeComponent(index, generation, typeId)) this.membership += 1;
  }

  private applyDormant(index: number, generation: number, dormant: boolean): void {
    this.deps.bridge.setEntityDormant(index, generation, dormant);
  }

  private addDeferred<D extends ComponentDefinition<ComponentSchema>>(
    def: D,
    data: Partial<InferComponent<D>>,
    index: number,
    generation: number,
    typeId: number,
  ): void {
    if (!this.mirror.isAlive(index, generation)) {
      this.queueAdd(def, data, index, generation, typeId);
      return;
    }
    if (
      !this.queuedRemoval(index, generation, typeId) &&
      this.deps.bridge.hasComponent(index, generation, typeId)
    ) {
      this.writePresent(def, data, index, generation, typeId);
      return;
    }
    const queued = this.latestQueuedAdd(index, generation, typeId);
    if (queued >= 0) {
      this.patchAdd(queued, data);
      return;
    }
    this.bumpRows(index, 1);
    this.queueAdd(def, data, index, generation, typeId);
  }

  private queueAdd(
    def: ComponentDefinition<ComponentSchema>,
    data: object,
    index: number,
    generation: number,
    typeId: number,
  ): void {
    const slot = this.pushOp(OP_ADD, index, generation, typeId, 0);
    this.addDefs[slot] = def;
    this.addData[slot] = data;
  }

  private patchAdd(slot: number, data: object): void {
    const target = this.addData[slot];
    if (target === null || target === undefined) {
      this.addData[slot] = data;
      return;
    }
    const into = target as Record<string, unknown>;
    const from = data as Record<string, unknown>;
    for (const key in from) {
      if (!Object.prototype.hasOwnProperty.call(from, key)) continue;
      into[key] = from[key];
    }
  }

  private queuedRemoval(index: number, generation: number, typeId: number): boolean {
    let removed = false;
    const count = this.opCount;
    for (let slot = 0; slot < count; slot += 1) {
      if (this.opIndexes[slot] !== index || this.opGenerations[slot] !== generation) continue;
      const kind = this.opKinds[slot];
      if (kind === OP_DESTROY) return true;
      if (kind === OP_REMOVE && this.opTypes[slot] === typeId) removed = true;
      else if (kind === OP_ADD && this.opTypes[slot] === typeId) removed = false;
    }
    return removed;
  }

  private latestQueuedAdd(index: number, generation: number, typeId: number): number {
    let found = -1;
    const count = this.opCount;
    for (let slot = 0; slot < count; slot += 1) {
      if (this.opIndexes[slot] !== index || this.opGenerations[slot] !== generation) continue;
      const kind = this.opKinds[slot];
      if (kind === OP_DESTROY) return -1;
      if (kind === OP_REMOVE && this.opTypes[slot] === typeId) found = -1;
      else if (kind === OP_ADD && this.opTypes[slot] === typeId) found = slot;
    }
    return found;
  }

  private simulatedHas(index: number, generation: number, typeId: number): boolean {
    if (!this.mirror.isAlive(index, generation)) return false;
    let present = this.deps.bridge.hasComponent(index, generation, typeId);
    const count = this.opCount;
    for (let slot = 0; slot < count; slot += 1) {
      if (this.opIndexes[slot] !== index || this.opGenerations[slot] !== generation) continue;
      const kind = this.opKinds[slot];
      if (kind === OP_DESTROY) return false;
      if (kind === OP_REMOVE && this.opTypes[slot] === typeId) present = false;
      else if (kind === OP_ADD && this.opTypes[slot] === typeId) present = true;
    }
    return present;
  }

  private bumpRows(index: number, delta: number): void {
    this.ensureRows(index);
    const next = (this.rowCounts[index] ?? 0) + delta;
    this.rowCounts[index] = next > 0 ? next : 0;
  }

  private clearRows(index: number): void {
    if (index < this.rowCounts.length) this.rowCounts[index] = 0;
  }

  private rowCount(index: number): number {
    if (index >= this.rowCounts.length) return 0;
    return this.rowCounts[index] ?? 0;
  }

  private ensureRows(index: number): void {
    if (index < this.rowCounts.length) return;
    let next = this.rowCounts.length === 0 ? 8 : this.rowCounts.length;
    while (next <= index) next *= 2;
    const counts = new Uint16Array(next);
    counts.set(this.rowCounts);
    this.rowCounts = counts;
  }

  private pushOp(
    kind: number,
    index: number,
    generation: number,
    typeId: number,
    flag: number,
  ): number {
    const slot = this.opCount;
    this.ensureOps(slot + 1);
    this.opKinds[slot] = kind;
    this.opIndexes[slot] = index;
    this.opGenerations[slot] = generation;
    this.opTypes[slot] = typeId;
    this.opFlags[slot] = flag;
    this.opCount = slot + 1;
    return slot;
  }

  private ensureOps(needed: number): void {
    if (needed <= this.opCapacity) return;
    let next = this.opCapacity === 0 ? 8 : this.opCapacity;
    while (next < needed) next *= 2;
    const kinds = new Uint8Array(next);
    const indexes = new Uint32Array(next);
    const generations = new Uint32Array(next);
    const types = new Uint32Array(next);
    const flags = new Uint8Array(next);
    if (this.opCapacity > 0) {
      kinds.set(this.opKinds);
      indexes.set(this.opIndexes);
      generations.set(this.opGenerations);
      types.set(this.opTypes);
      flags.set(this.opFlags);
    }
    const defs: (ComponentDefinition<ComponentSchema> | null)[] = [];
    const data: (object | null)[] = [];
    defs.length = next;
    data.length = next;
    for (let slot = 0; slot < this.opCount; slot += 1) {
      defs[slot] = this.addDefs[slot] ?? null;
      data[slot] = this.addData[slot] ?? null;
    }
    this.opKinds = kinds;
    this.opIndexes = indexes;
    this.opGenerations = generations;
    this.opTypes = types;
    this.opFlags = flags;
    this.addDefs = defs;
    this.addData = data;
    this.opCapacity = next;
  }

  private clearOps(): void {
    const count = this.opCount;
    const kinds = this.opKinds;
    for (let slot = 0; slot < count; slot += 1) {
      if (kinds[slot] !== OP_ADD) continue;
      this.addDefs[slot] = null;
      this.addData[slot] = null;
    }
    this.opCount = 0;
  }

  /**
   * Check whether an entity is currently alive.
   *
   * @param id - The entity to check
   * @returns `true` if alive
   */
  isAlive(id: EntityId): boolean {
    return this.deps.bridge.isAlive(entityIndex(id), entityGeneration(id));
  }

  /**
   * Slot flag used by actor pools. Not a component and not on {@link GwenEngine}.
   * Returns false when `id` is not alive, without changing state.
   */
  setDormant(id: EntityId, dormant: boolean): boolean {
    const index = entityIndex(id);
    const generation = entityGeneration(id);
    if (this.depth === 0) return this.deps.bridge.setEntityDormant(index, generation, dormant);
    if (!this.mirror.isAlive(index, generation) || this.rowCount(index) === 0) return false;
    this.pushOp(OP_DORMANT, index, generation, 0, dormant ? 1 : 0);
    return true;
  }

  /**
   * Attach a component to an entity.
   * Cold add writes defaults, then `data`. An in-place add patches only `data`'s keys.
   */
  addComponent<D extends ComponentDefinition<ComponentSchema>>(
    id: EntityId,
    def: D,
    data: Partial<InferComponent<D>>,
  ): void {
    this.deps.assertState("addComponent");
    const typeId = componentRegistryFor(this.deps.engine).getOrRegister(def);
    const index = entityIndex(id);
    const generation = entityGeneration(id);
    if (this.depth > 0) {
      this.addDeferred(def, data, index, generation, typeId);
      return;
    }
    if (this.deps.bridge.hasComponent(index, generation, typeId)) {
      this.writePresent(def, data, index, generation, typeId);
      return;
    }
    if (this.writeCold(def, data, index, generation, typeId)) {
      this.membership += 1;
      this.bumpRows(index, 1);
    }
  }

  /** In-place lane write. Kept small so the call allocates nothing. */
  private writePresent<D extends ComponentDefinition<ComponentSchema>>(
    def: D,
    data: Partial<InferComponent<D>>,
    index: number,
    generation: number,
    typeId: number,
  ): void {
    const stored = this.storedLayout(def);
    const view = componentStaging(this.deps.engine, this.readStagingPtr);
    this.deps.bridge.readComponentStaged(index, generation, typeId);
    stored.layout.patch(view, data, stringPoolFor(this.deps.engine));
    this.deps.bridge.writeComponentStaged(index, generation, typeId);
  }

  /** First insert of a component row. Returns false when the entity is dead. */
  private writeCold<D extends ComponentDefinition<ComponentSchema>>(
    def: D,
    data: Partial<InferComponent<D>>,
    index: number,
    generation: number,
    typeId: number,
  ): boolean {
    const stored = this.storedLayout(def);
    const view = componentStaging(this.deps.engine, this.readStagingPtr);
    this.fillScratch(stored.scratch, def, data);
    stored.layout.serialize(stored.scratch, view, stringPoolFor(this.deps.engine));
    return this.deps.bridge.writeComponentStaged(index, generation, typeId);
  }

  /**
   * Retrieve a component from an entity.
   *
   * @returns A snapshot of the row, or `undefined`
   */
  getComponent<D extends ComponentDefinition<ComponentSchema>>(
    id: EntityId,
    def: D,
  ): Readonly<InferComponent<D>> | undefined {
    const typeId = componentRegistryFor(this.deps.engine).get(def.name);
    if (typeId === undefined) return undefined;
    if (!this.deps.bridge.readComponentStaged(entityIndex(id), entityGeneration(id), typeId)) {
      return undefined;
    }
    const stored = this.storedLayout(def);
    const view = componentStaging(this.deps.engine, this.readStagingPtr);
    const value = stored.layout.deserialize(view, stringPoolFor(this.deps.engine));
    return freezeSnapshot(value) as Readonly<InferComponent<D>>;
  }

  /**
   * Check whether an entity has a specific component.
   * @returns `true` if the component is present
   */
  hasComponent<D extends ComponentDefinition<ComponentSchema>>(id: EntityId, def: D): boolean {
    const typeId = componentRegistryFor(this.deps.engine).get(def.name);
    if (typeId === undefined) return false;
    return this.deps.bridge.hasComponent(entityIndex(id), entityGeneration(id), typeId);
  }

  /**
   * Remove a component from an entity.
   * @returns `true` if the component existed and was removed
   */
  removeComponent<D extends ComponentDefinition<ComponentSchema>>(id: EntityId, def: D): boolean {
    this.deps.assertState("removeComponent");
    const typeId = componentRegistryFor(this.deps.engine).get(def.name);
    if (typeId === undefined) return false;
    const index = entityIndex(id);
    const generation = entityGeneration(id);
    if (this.depth > 0) {
      if (!this.simulatedHas(index, generation, typeId)) return false;
      this.bumpRows(index, -1);
      this.pushOp(OP_REMOVE, index, generation, typeId, 0);
      return true;
    }
    const removed = this.deps.bridge.removeComponent(index, generation, typeId);
    if (removed) {
      this.membership += 1;
      this.bumpRows(index, -1);
    }
    return removed;
  }

  /**
   * Create a live query that reflects the current ECS state on each iteration.
   *
   * A component query reads awake rows from `query_chunks`. Dormant rows are
   * absent from that list. An empty component list is not a wasm query and
   * still lists every alive slot this engine created, including dormant rows.
   * Iteration of that empty list skips dormant ids.
   *
   * The id array object stays across a dormancy toggle. The toggle bumps
   * `storage_generation`, and the same array is refilled from the awake rows.
   */
  createQuery<const C extends readonly ComponentDef[]>(
    components: C,
    precomputedKey?: string,
  ): Query<C> {
    const query = createChunkQuery(
      this.deps.engine,
      this.deps.bridge,
      components,
      () => this.createLiveQuery(components, precomputedKey),
      this.loopHooks,
    );
    this.chunkQueries.push(query);
    return query;
  }

  createLiveQuery<const C extends readonly ComponentDef[]>(
    components: C,
    precomputedKey?: string,
  ): LiveQuery<EntityAccessor<C>> {
    const resolveIds = (): readonly EntityId[] => this.resolveIds(components, precomputedKey);
    const bridge = this.deps.bridge;
    const skipDormant = components.length === 0;
    const readComponent = <D extends C[number]>(id: EntityId, def: D): InferComponent<D> => {
      return this.getComponent(id, def) as InferComponent<D>; // boundary: queried component is present #77
    };
    return {
      [Symbol.iterator](): Iterator<EntityAccessor<C>, undefined> {
        const results = resolveIds();
        let i = 0;
        return {
          next(): IteratorResult<EntityAccessor<C>, undefined> {
            while (i < results.length) {
              const id = readResolvedEntityId(results, i);
              i += 1;
              if (skipDormant && bridge.isEntityDormant(entityIndex(id), entityGeneration(id))) {
                continue;
              }
              return {
                done: false,
                value: {
                  id,
                  get<D extends C[number]>(def: D): InferComponent<D> {
                    return readComponent(id, def);
                  },
                },
              };
            }
            return { done: true, value: undefined };
          },
        };
      },
    };
  }

  /**
   * Ids that match every component.
   *
   * A component query is one `register_query` handle. `resolveIds` refills
   * the same array when `storage_generation` changes, and returns that array
   * when the generation is unchanged. A dormancy toggle bumps the generation
   * and refills the awake rows, so the array object stays. An in-place write
   * does not bump it. `releaseQueries` drops the handle on engine stop.
   *
   * An empty list cannot be registered (`register_query` rejects it). That
   * path still lists alive slots this engine created, including dormant rows.
   */
  resolveIds(components: readonly ComponentDef[], precomputedKey?: string): readonly EntityId[] {
    const key = precomputedKey ?? components.map((def) => def.name).join("|");
    if (components.length === 0) {
      const epoch = this.aliveEpoch;
      const cached = this.idLists.get(key);
      if (cached !== undefined && cached.membership === epoch) return cached.ids;
      const fresh = this.readAliveIds();
      this.idLists.set(key, { ids: fresh, membership: epoch });
      return fresh;
    }
    const generation = this.deps.bridge.storageGeneration();
    const cached = this.memberLists.get(key);
    if (cached !== undefined && cached.generation === generation) return cached.ids;
    if (cached === undefined) {
      const query = this.memberQuery(components);
      if (query === null) return [];
      const ids: EntityId[] = [];
      this.fillChunkIds(query, ids);
      this.memberLists.set(key, { ids, generation, query });
      return ids;
    }
    this.fillChunkIds(cached.query, cached.ids);
    cached.generation = generation;
    return cached.ids;
  }

  /** Drop every component-query handle. Called from `engine:stop` while WASM is alive. */
  releaseQueries(): void {
    for (const query of this.chunkQueries) releaseChunkQuery(query);
    this.chunkQueries.length = 0;
    if (!this.deps.bridge.isActive()) {
      this.memberLists.clear();
      return;
    }
    for (const entry of this.memberLists.values()) {
      this.deps.bridge.releaseQuery(entry.query);
    }
    this.memberLists.clear();
  }

  /** `null` when a component type is not registered yet. */
  private memberQuery(components: readonly ComponentDef[]): number | null {
    const registry = componentRegistryFor(this.deps.engine);
    const typeIds: number[] = [];
    for (let index = 0; index < components.length; index += 1) {
      const def = components[index];
      if (def === undefined) continue;
      const typeId = registry.get(def.name);
      if (typeId === undefined) return null;
      typeIds.push(typeId);
    }
    if (typeIds.length === 0) return null;
    return this.deps.bridge.registerQuery(new Uint32Array(typeIds));
  }

  /**
   * Awake `(index, generation)` pairs from the query table.
   * A row that already holds that pair keeps its bigint.
   */
  private fillChunkIds(query: number, into: EntityId[]): void {
    const ptr = this.deps.bridge.queryChunks(query);
    const memory = this.deps.engine.memory.linearMemory();
    if (memory === null || ptr <= 0) {
      into.length = 0;
      return;
    }
    const buffer = memory.buffer;
    const header = new Uint32Array(buffer, ptr, 4);
    const chunkCount = header[0] ?? 0;
    const stride = header[2] ?? 0;
    if (chunkCount === 0 || stride < 4) {
      into.length = 0;
      return;
    }
    const words = 4 + chunkCount * stride;
    const table = new Uint32Array(buffer, ptr, words);
    let write = 0;
    for (let chunk = 0; chunk < chunkCount; chunk += 1) {
      const base = 4 + chunk * stride;
      const count = table[base + 1] ?? 0;
      const indexPtr = table[base + 2] ?? 0;
      const generationPtr = table[base + 3] ?? 0;
      if (count === 0 || indexPtr <= 0 || generationPtr <= 0) continue;
      const indexes = new Uint32Array(buffer, indexPtr, count);
      const generations = new Uint32Array(buffer, generationPtr, count);
      for (let row = 0; row < count; row += 1) {
        const index = indexes[row] ?? 0;
        const generation = generations[row] ?? 0;
        const kept = into[write];
        if (
          kept !== undefined &&
          entityIndex(kept) === index &&
          entityGeneration(kept) === generation
        ) {
          write += 1;
          continue;
        }
        into[write] = createEntityId(index, generation);
        write += 1;
      }
    }
    into.length = write;
  }

  /** Alive entity ids, including dormant rows. An empty type list is not a WASM query. */
  private readAliveIds(): EntityId[] {
    const bridge = this.deps.bridge;
    const ids: EntityId[] = [];
    for (let index = 0; index < this.slotSpan; index += 1) {
      const generation = bridge.getEntityGeneration(index);
      if (!bridge.isAlive(index, generation)) continue;
      ids.push(createEntityId(index, generation));
    }
    return ids;
  }

  private storedLayout<D extends ComponentDefinition<ComponentSchema>>(def: D): StoredLayout {
    const existing = this.layouts.get(def.name);
    if (existing !== undefined) return existing;
    const layout = computeSchemaLayout(def.schema) as SchemaLayout<Record<string, unknown>>;
    const scratch: Record<string, unknown> = {};
    const stored = { layout, scratch };
    this.layouts.set(def.name, stored);
    return stored;
  }

  private fillScratch<D extends ComponentDefinition<ComponentSchema>>(
    scratch: Record<string, unknown>,
    def: D,
    data: Partial<InferComponent<D>>,
  ): void {
    const defaults = def.defaults ?? {};
    const patch = data as Record<string, unknown>;
    for (const key of Object.keys(def.schema)) {
      if (Object.prototype.hasOwnProperty.call(patch, key) && patch[key] !== undefined) {
        scratch[key] = patch[key];
      } else {
        scratch[key] = (defaults as Record<string, unknown>)[key];
      }
    }
  }
}

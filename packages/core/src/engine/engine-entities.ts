import {
  computeSchemaLayout,
  type ComponentDefinition,
  type ComponentSchema,
  type InferComponent,
  type SchemaLayout,
} from "../schema.js";
import { createEntityId, entityGeneration, entityIndex, type EntityId } from "../types/entity.js";
import type { ComponentDef, EntityAccessor, LiveQuery } from "../system/runtime/define-system.js";
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
  /** Bumps on a cold add, a remove, or a destroy. Dormancy does not bump it. */
  private membership = 0;
  /** Bumps when an entity is created or destroyed. Component queries ignore it. */
  private aliveEpoch = 0;
  /** One past the highest slot index this engine has allocated. */
  private slotSpan = 0;

  private readonly readStagingPtr = (): number => this.deps.bridge.componentStagingPtr();

  constructor(private readonly deps: EngineEntitiesDeps) {}

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
    if (!this.deps.bridge.deleteEntity(index, generation)) return false;
    this.membership += 1;
    this.aliveEpoch += 1;
    this.deps.emitDestroy(id);
    return true;
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
    return this.deps.bridge.setEntityDormant(entityIndex(id), entityGeneration(id), dormant);
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
    if (this.deps.bridge.hasComponent(index, generation, typeId)) {
      this.writePresent(def, data, index, generation, typeId);
      return;
    }
    if (this.writeCold(def, data, index, generation, typeId)) this.membership += 1;
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
    const removed = this.deps.bridge.removeComponent(entityIndex(id), entityGeneration(id), typeId);
    if (removed) this.membership += 1;
    return removed;
  }

  /**
   * Create a live query that reflects the current ECS state on each iteration.
   * Dormant rows are absent. The registered query stays cached across a dormancy toggle.
   */
  createLiveQuery<const C extends readonly ComponentDef[]>(
    components: C,
    precomputedKey?: string,
  ): LiveQuery<EntityAccessor<C>> {
    const resolveIds = (): readonly EntityId[] => this.resolveIds(components, precomputedKey);
    const bridge = this.deps.bridge;
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
              if (bridge.isEntityDormant(entityIndex(id), entityGeneration(id))) continue;
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
   * Ids that have every component, including dormant rows.
   * The same array until a component is added or removed.
   * Iteration skips dormant ids. The array itself stays.
   */
  resolveIds(components: readonly ComponentDef[], precomputedKey?: string): readonly EntityId[] {
    const key = precomputedKey ?? components.map((def) => def.name).join("|");
    const epoch = components.length === 0 ? this.aliveEpoch : this.membership;
    const cached = this.idLists.get(key);
    if (cached !== undefined && cached.membership === epoch) return cached.ids;
    const fresh = components.length === 0 ? this.readAliveIds() : this.readMemberIds(components);
    this.idLists.set(key, { ids: fresh, membership: epoch });
    return fresh;
  }

  /** Alive ids that have every component. Dormant rows stay in the list. */
  private readMemberIds(components: readonly ComponentDef[]): EntityId[] {
    const bridge = this.deps.bridge;
    const registry = componentRegistryFor(this.deps.engine);
    const typeIds: number[] = [];
    for (let index = 0; index < components.length; index += 1) {
      const def = components[index];
      if (def === undefined) continue;
      const typeId = registry.get(def.name);
      if (typeId === undefined) return [];
      typeIds.push(typeId);
    }
    const ids: EntityId[] = [];
    for (let index = 0; index < this.slotSpan; index += 1) {
      const generation = bridge.getEntityGeneration(index);
      if (!bridge.isAlive(index, generation)) continue;
      let matches = true;
      for (let type = 0; type < typeIds.length; type += 1) {
        const typeId = typeIds[type];
        if (typeId === undefined || !bridge.hasComponent(index, generation, typeId)) {
          matches = false;
          break;
        }
      }
      if (matches) ids.push(createEntityId(index, generation));
    }
    return ids;
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

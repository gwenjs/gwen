/**
 * ECS — Entity Component System (TypeScript)
 *
 * Pure TS implementation mirroring the Rust/WASM core logic.
 * Uses the same patterns: generation counter, free list, SoA-style storage.
 */

import type { ComponentDefinition, ComponentSchema } from '../schema';
import type { EntityId } from '../types/entity';
import {
  buildQueryCacheKey,
  normalizeComponentTypesForQuery,
  type ComponentTypeInput,
} from './component-type-normalizer';
import { createEntityId, unpackEntityId } from '../types/entity';

// Re-export EntityId as part of the ECS module's public API
export type { EntityId } from '../types/entity';

/** A single component definition — shorthand for use in query descriptors. */
export type ComponentDef = ComponentDefinition<ComponentSchema>;

/**
 * Descriptor-based query — fine-grained filter over the entity set.
 *
 * @example
 * ```ts
 * query: { all: [Position, Velocity], none: [Frozen] }
 * ```
 */
export interface SystemQueryDescriptor {
  /** Entities that have ALL of these components. */
  all?: ComponentDef[];
  /** Entities that have AT LEAST ONE of these components. */
  any?: ComponentDef[];
  /** Entities that have NONE of these components. */
  none?: ComponentDef[];
  /**
   * Entities that carry this tag (marker-component name).
   * Tags are zero-data components registered as strings.
   */
  tag?: string;
}

/** Query type accepted by systems. */
export type SystemQuery = ComponentDef[] | SystemQueryDescriptor;

// ============= Entity Manager =============

/**
 * Entity ID format: 64-bit BigInt with generation (32-bit) + index (32-bit).
 * Allows detecting stale references (use-after-free).
 */

function idIndex(id: EntityId): number {
  const { index } = unpackEntityId(id);
  return index;
}

function idGeneration(id: EntityId): number {
  const { generation } = unpackEntityId(id);
  return generation;
}

export class EntityManager {
  private generations: Uint32Array;
  private alive: Uint8Array; // 1 = alive, 0 = dead
  private freeList: number[] = [];
  private liveCount = 0;
  readonly maxEntities: number;

  constructor(maxEntities: number) {
    this.maxEntities = maxEntities;
    this.generations = new Uint32Array(maxEntities);
    this.alive = new Uint8Array(maxEntities);
  }

  /** Create a new entity. Returns its EntityId. Throws if at capacity. */
  create(): EntityId {
    let index: number;

    if (this.freeList.length > 0) {
      index = this.freeList.pop()!;
    } else {
      index = this.liveCount;
      if (index >= this.maxEntities) {
        throw new Error(`[ECS] Entity capacity exceeded (max: ${this.maxEntities})`);
      }
    }

    const gen = this.generations[index] ?? 0;
    this.alive[index] = 1;
    this.liveCount++;
    return createEntityId(index, gen);
  }

  /** Destroy an entity. Returns true if it was alive. */
  destroy(id: EntityId): boolean {
    const index = idIndex(id);
    const gen = idGeneration(id);

    if (!this.isAlive(id)) return false;

    this.alive[index] = 0;
    // Increment generation to invalidate all old references (u32 wrapping like Rust)
    this.generations[index] = (gen + 1) >>> 0; // >>> 0 forces unsigned 32-bit
    this.freeList.push(index);
    this.liveCount--;
    return true;
  }

  /** Check if entity is still alive (validates generation). */
  isAlive(id: EntityId): boolean {
    const index = idIndex(id);
    const gen = idGeneration(id);
    if (index >= this.maxEntities) return false;
    return this.alive[index] === 1 && this.generations[index] === gen;
  }

  /** Number of currently alive entities. */
  count(): number {
    return this.liveCount;
  }

  /** Get the current generation for a slot index. Returns 0 if out of bounds. */
  getGeneration(slotIndex: number): number {
    if (slotIndex >= this.maxEntities) return 0;
    return this.generations[slotIndex] ?? 0;
  }

  /** Iterate over all alive entity IDs. */
  *[Symbol.iterator](): Iterator<EntityId> {
    for (let i = 0; i < this.maxEntities; i++) {
      if (this.alive[i] === 1) {
        yield createEntityId(i, this.generations[i] ?? 0);
      }
    }
  }
}

// ============= Component Registry =============

export type ComponentType = string;

/**
 * Stores all component data keyed by EntityId index.
 * Each component type has its own Map for cache efficiency.
 */
export class ComponentRegistry {
  // componentType → (entityIndex → data)
  private storage = new Map<ComponentType, Map<number, unknown>>();

  /** Register a new component type (idempotent). */
  register(type: ComponentType): void {
    if (!this.storage.has(type)) {
      this.storage.set(type, new Map());
    }
  }

  /** Add or update a component on an entity. */
  add<T>(
    entityId: EntityId,
    type: ComponentType | ComponentDefinition<import('../schema').ComponentSchema>,
    data: T,
  ): void {
    const key = typeof type === 'string' ? type : type.name;
    if (!this.storage.has(key)) {
      this.storage.set(key, new Map());
    }
    this.storage.get(key)!.set(idIndex(entityId), data);
  }

  /** Remove a component from an entity. Returns true if it existed. */
  remove(
    entityId: EntityId,
    type: ComponentType | ComponentDefinition<import('../schema').ComponentSchema>,
  ): boolean {
    const key = typeof type === 'string' ? type : type.name;
    const map = this.storage.get(key);
    if (!map) return false;
    return map.delete(idIndex(entityId));
  }

  /** Get a component by entity and type. Returns undefined if absent. */
  get<T>(
    entityId: EntityId,
    type: ComponentType | ComponentDefinition<import('../schema').ComponentSchema>,
  ): T | undefined {
    const key = typeof type === 'string' ? type : type.name;
    return this.storage.get(key)?.get(idIndex(entityId)) as T | undefined;
  }

  /** Check if an entity has a component. */
  has(
    entityId: EntityId,
    type: ComponentType | ComponentDefinition<import('../schema').ComponentSchema>,
  ): boolean {
    const key = typeof type === 'string' ? type : type.name;
    return this.storage.get(key)?.has(idIndex(entityId)) ?? false;
  }

  /** Remove all components for a given entity (called on entity destroy). */
  removeAll(entityId: EntityId): void {
    const index = idIndex(entityId);
    for (const map of this.storage.values()) {
      map.delete(index);
    }
  }

  /** All registered component types. */
  registeredTypes(): ComponentType[] {
    return [...this.storage.keys()];
  }
}

// ============= Query Engine =============

/**
 * Finds entities that have ALL required component types.
 * Caches results and invalidates on component mutations.
 */
export class QueryEngine {
  private cache = new Map<string, EntityId[]>();
  private dirty = true;

  invalidate(): void {
    this.dirty = true;
    this.cache.clear();
  }

  /**
   * Resolve a `SystemQuery` descriptor against the TS-side ECS.
   *
   * Supports all filter fields: `all`, `any`, `none`, `tag`.
   * Results are NOT cached — call `query()` directly for cache-aware execution.
   *
   * Used by tests and the pure-TS ECS path. The engine itself delegates to the
   * WASM bridge for production query execution.
   */
  resolve(
    queryDesc: SystemQuery,
    entities: EntityManager,
    components: ComponentRegistry,
  ): EntityId[] {
    const desc: SystemQueryDescriptor = Array.isArray(queryDesc) ? { all: queryDesc } : queryDesc;

    // 1. 'all' filter — primary requirement
    const allRequired = (desc.all ?? []).map((d) => (typeof d === 'string' ? d : d.name));
    let results = this.query(allRequired, entities, components);

    // 2. 'any' filter — at least one
    if (desc.any && desc.any.length > 0) {
      const anyNames = desc.any.map((d) => (typeof d === 'string' ? d : d.name));
      results = results.filter((id) => anyNames.some((type) => components.has(id, type)));
    }

    // 3. 'none' filter — exclusion
    if (desc.none && desc.none.length > 0) {
      const noneNames = desc.none.map((d) => (typeof d === 'string' ? d : d.name));
      results = results.filter((id) => !noneNames.some((type) => components.has(id, type)));
    }

    // 4. 'tag' filter — marker component
    if (desc.tag) {
      const tag = desc.tag;
      results = results.filter((id) => components.has(id, tag));
    }

    return results;
  }

  /**
   * Return all entities (from EntityManager) that have ALL required types.
   * Results are cached until next invalidation.
   *
   * Accepts both string names and ComponentDefinition objects.
   */
  query(
    required: ComponentTypeInput[],
    entities: EntityManager,
    components: ComponentRegistry,
  ): EntityId[] {
    const normalizedRequired = normalizeComponentTypesForQuery(required);

    if (normalizedRequired.length === 0) {
      // Return all alive entities
      return [...entities];
    }

    const cacheKey = buildQueryCacheKey(normalizedRequired);

    if (!this.dirty && this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    const results: EntityId[] = [];
    for (const id of entities) {
      if (normalizedRequired.every((type) => components.has(id, type))) {
        results.push(id);
      }
    }

    this.cache.set(cacheKey, results);
    this.dirty = false;
    return results;
  }
}

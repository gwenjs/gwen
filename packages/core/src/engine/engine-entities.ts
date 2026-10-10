import type { ComponentDefinition, ComponentSchema, InferComponent } from "../schema.js";
import { ComponentRegistry, EntityManager, QueryEngine } from "../core/ecs.js";
import type { EntityId } from "./engine-api.js";
import type { ComponentType } from "../types.js";
import type { ComponentDef, EntityAccessor, LiveQuery } from "../system/runtime/define-system.js";

/**
 * `createEntity`, `addComponent`, `removeComponent`, and `destroyEntity` call
 * `assertState` before they change the map. The facade passes `_assertNotFaulted`.
 * `registerComponent` is the facade's `getOrRegisterComponent`.
 * `emitDestroy` is the facade's entity:destroy fan-out.
 */
export interface EngineEntitiesDeps {
  maxEntities: number;
  queryCacheSize: number;
  assertState: (method: string) => void;
  registerComponent: (type: ComponentType) => number;
  emitDestroy: (id: EntityId) => void;
}

function readResolvedEntityId(results: readonly EntityId[], index: number): EntityId {
  return results[index] as EntityId; // boundary: dense query id list, index checked #77
}

/**
 * Entity ids, component rows, and live queries for one engine.
 * @internal
 */
export class EngineEntities {
  private readonly _entityManager: EntityManager;
  private readonly _componentRegistry: ComponentRegistry;
  private readonly _queryEngine: QueryEngine;

  constructor(private readonly deps: EngineEntitiesDeps) {
    this._entityManager = new EntityManager(deps.maxEntities);
    this._componentRegistry = new ComponentRegistry();
    this._queryEngine = new QueryEngine(deps.queryCacheSize);
  }

  /** Alive entity ids. `getStats().entityCount` reads this. */
  count(): number {
    return this._entityManager.count();
  }

  /**
   * Create a new entity.
   * @returns A fresh {@link EntityId}.
   * @throws {GwenError} code `CORE:ENTITY_LIMIT_REACHED` when the entity capacity is exceeded.
   */
  createEntity(): EntityId {
    this.deps.assertState("createEntity");
    return this._entityManager.create();
  }

  canSpawn(count: number): boolean {
    return this._entityManager.canSpawn(count);
  }

  /**
   * Destroy an entity and remove all its components.
   *
   * @param id - The entity to destroy
   * @returns `true` if it was alive and is now destroyed
   */
  destroyEntity(id: EntityId): boolean {
    this.deps.assertState("destroyEntity");
    if (!this._entityManager.destroy(id)) return false;
    this._componentRegistry.removeAll(id);
    this._queryEngine.invalidate();
    // Synchronous and isolated. callHook stops after a throw, so the caller catches each handler.
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
    return this._entityManager.isAlive(id);
  }

  /**
   * Slot flag used by actor pools. Not a component and not on {@link GwenEngine}.
   * Returns false when `id` is not alive, without changing state.
   */
  setDormant(id: EntityId, dormant: boolean): boolean {
    return this._entityManager.setDormant(id, dormant);
  }

  /**
   * Attach a component to an entity.
   * Merges `def.defaults` with the supplied `data` (data wins on conflict).
   */
  addComponent<D extends ComponentDefinition<ComponentSchema>>(
    id: EntityId,
    def: D,
    data: Partial<InferComponent<D>>,
  ): void {
    this.deps.assertState("addComponent");
    const existing = this._componentRegistry.get<InferComponent<D>>(id, def);
    if (existing !== undefined) {
      // Membership is unchanged, so the query cache stays as it is.
      // The type id was registered on the first add.
      Object.assign(existing, data);
      return;
    }
    // Cold path — first add for this entity/component pair: allocate once.
    this.deps.registerComponent(def.name);
    const merged = Object.assign({}, def.defaults, data) as InferComponent<D>;
    this._componentRegistry.add(id, def, merged);
    this._queryEngine.invalidate();
  }

  /**
   * Retrieve a component from an entity.
   *
   * @returns The stored component data, or `undefined`
   */
  getComponent<D extends ComponentDefinition<ComponentSchema>>(
    id: EntityId,
    def: D,
  ): InferComponent<D> | undefined {
    return this._componentRegistry.get<InferComponent<D>>(id, def);
  }

  /**
   * Check whether an entity has a specific component.
   * @returns `true` if the component is present
   */
  hasComponent<D extends ComponentDefinition<ComponentSchema>>(id: EntityId, def: D): boolean {
    return this._componentRegistry.has(id, def);
  }

  /**
   * Remove a component from an entity.
   * @returns `true` if the component existed and was removed
   */
  removeComponent<D extends ComponentDefinition<ComponentSchema>>(id: EntityId, def: D): boolean {
    this.deps.assertState("removeComponent");
    const removed = this._componentRegistry.remove(id, def);
    if (removed) this._queryEngine.invalidate();
    return removed;
  }

  /**
   * Create a live query that reflects the current ECS state on each iteration.
   */
  createLiveQuery<const C extends readonly ComponentDef[]>(
    components: C,
    _precomputedKey?: string,
  ): LiveQuery<EntityAccessor<C>> {
    // Capture specific members once — avoids both closure allocation on every
    // iteration start and the no-this-alias lint rule.
    const queryEngine = this._queryEngine;
    const entityManager = this._entityManager;
    const componentRegistry = this._componentRegistry;
    return {
      [Symbol.iterator](): Iterator<EntityAccessor<C>, undefined> {
        const results = queryEngine.resolve(
          components,
          entityManager,
          componentRegistry,
          _precomputedKey,
        );
        let i = 0;
        return {
          next(): IteratorResult<EntityAccessor<C>, undefined> {
            while (i < results.length) {
              const id = readResolvedEntityId(results, i);
              i += 1;
              // Dormant slots stay in the cached id list. Iteration skips them.
              if (entityManager.isDormant(id)) continue;
              return {
                done: false,
                value: {
                  id,
                  get<D extends C[number]>(def: D): InferComponent<D> {
                    return componentRegistry.get<InferComponent<D>>(id, def) as InferComponent<D>; // boundary: queried component is present #77
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

  /** Ids matched by the query, including dormant slots. */
  resolveIds(components: readonly ComponentDef[]): readonly EntityId[] {
    return this._queryEngine.resolve(components, this._entityManager, this._componentRegistry);
  }
}

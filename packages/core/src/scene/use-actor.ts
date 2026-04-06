/**
 * @file RFC-011 Task 7 — `useActor()`, `usePrefab()`, `useComponent()` composables
 *
 * These composables are designed to be called inside:
 * - `useActor` / `usePrefab` — inside `engine.run()` or another engine context
 * - `useComponent` — inside a `defineActor()` factory function (actor spawn context)
 *
 * @example
 * ```typescript
 * // Manage actor instances from a system or scene:
 * const handle = useActor(EnemyActor);
 * const id = handle.spawn({ hp: 100 });
 * handle.despawnAll();
 *
 * // Spawn prefab entities without actor behaviour:
 * const { spawn, despawn } = usePrefab(BulletPrefab);
 * const id = spawn({ x: 10, y: 20 });
 *
 * // Read / write a component on the current actor's entity:
 * const Actor = defineActor(MyPrefab, () => {
 *   const pos = useComponent(Position);
 *   onUpdate(() => { pos.x += 1; });
 * });
 * ```
 */

import { useEngine } from '../context.js';
import { _getActorEntityId, _getActorEngine } from './define-actor.js';
import type { ActorDefinition, PrefabDefinition } from './types.js';
import type { ComponentDefinition, ComponentSchema } from '../schema.js';
import type { EntityId } from '../engine/engine-api.js';

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Handle returned by {@link useActor}.
 * Provides typed spawn/despawn/query helpers for a given actor type.
 *
 * @template Props - Props accepted by `spawn`.
 * @template PublicAPI - The public API object exposed by each instance.
 */
export interface ActorHandle<Props, PublicAPI> {
  /**
   * Spawn a new instance of the actor.
   *
   * @param props - Optional props forwarded to the actor factory.
   * @returns The ECS entity ID of the new instance.
   */
  spawn(props?: Props): bigint;

  /**
   * Despawn the actor instance with the given entity ID.
   *
   * @param id - Entity ID returned by `spawn`.
   */
  despawn(id: bigint): void;

  /**
   * Despawn every live instance of this actor type.
   */
  despawnAll(): void;

  /**
   * Returns the number of currently live instances.
   *
   * @returns Count of live actor instances.
   */
  count(): number;

  /**
   * Returns the public API of the **first** live instance, or `undefined` if
   * there are no live instances.
   *
   * @returns First instance's public API, or `undefined`.
   */
  get(): PublicAPI | undefined;

  /**
   * Returns the public APIs of **all** live instances.
   *
   * @returns Array of public API objects (empty if no instances exist).
   */
  getAll(): PublicAPI[];

  /**
   * Spawn a new instance only if no live instance exists yet.
   * On subsequent calls, returns the existing instance's entity ID.
   *
   * @param props - Optional props forwarded to the actor factory on first spawn.
   * @returns The singleton instance's entity ID.
   */
  spawnOnce(props?: Props): bigint;
}

/**
 * Handle returned by {@link usePrefab}.
 * Provides `spawn` / `despawn` helpers for a prefab-backed entity without actor behaviour.
 */
export interface PrefabHandle {
  /**
   * Create an entity and add the prefab's components with optional value overrides.
   *
   * The `overrides` object is merged (shallow) with each component's declared
   * defaults. Use this to customise individual field values at spawn time.
   *
   * @param overrides - Optional flat key-value overrides applied to all components.
   * @returns The new entity's ID.
   *
   * @example
   * ```typescript
   * const id = spawn({ x: 99 }); // overrides Position.x
   * ```
   */
  spawn(overrides?: Record<string, unknown>): bigint;

  /**
   * Destroy the entity with the given ID.
   *
   * @param id - Entity ID returned by `spawn`.
   */
  despawn(id: bigint): void;
}

// ─── useActor ─────────────────────────────────────────────────────────────────

/**
 * Returns a typed handle for spawning and managing instances of the given actor.
 *
 * Must be called inside an active engine context (e.g. `engine.run()`, a plugin
 * `setup()` callback, or a `defineSystem()` factory).
 *
 * The returned handle is **not** bound to the engine context — its methods may
 * be called freely from anywhere after the handle is created.
 *
 * @param actorDef - The actor definition produced by `defineActor()`.
 * @returns An {@link ActorHandle} for `actorDef`.
 *
 * @throws {GwenContextError} If called outside an active engine context.
 *
 * @example
 * ```typescript
 * const enemies = useActor(EnemyActor);
 * const id = enemies.spawn({ hp: 100 });
 * enemies.despawnAll();
 * ```
 */
export function useActor<Props, PublicAPI>(
  actorDef: ActorDefinition<Props, PublicAPI>,
): ActorHandle<Props, PublicAPI> {
  // Validate we are inside an engine context (throws GwenContextError if not).
  useEngine();

  /** Tracks the singleton entity ID used by `spawnOnce`. */
  let _singletonId: bigint | undefined;

  return {
    spawn(props?: Props): bigint {
      return actorDef._plugin.spawn(props);
    },

    despawn(id: bigint): void {
      if (_singletonId === id) _singletonId = undefined;
      actorDef._plugin.despawn(id);
    },

    despawnAll(): void {
      _singletonId = undefined;
      // Copy keys first — despawn() mutates _instances during iteration.
      for (const id of Array.from(actorDef._instances.keys())) {
        actorDef._plugin.despawn(id);
      }
    },

    count(): number {
      return actorDef._instances.size;
    },

    get(): PublicAPI | undefined {
      return actorDef._instances.values().next().value?.api;
    },

    getAll(): PublicAPI[] {
      const result: PublicAPI[] = [];
      for (const instance of actorDef._instances.values()) {
        result.push(instance.api);
      }
      return result;
    },

    spawnOnce(props?: Props): bigint {
      if (_singletonId !== undefined && actorDef._instances.has(_singletonId)) {
        return _singletonId;
      }
      _singletonId = actorDef._plugin.spawn(props);
      return _singletonId;
    },
  };
}

// ─── usePrefab ────────────────────────────────────────────────────────────────

/**
 * Returns spawn/despawn helpers for a prefab-backed entity that has no actor
 * behaviour (no factory, no lifecycle composables).
 *
 * Must be called inside an active engine context.
 *
 * @param prefabDef - The prefab definition produced by `definePrefab()`.
 * @returns A {@link PrefabHandle} with `spawn` and `despawn` methods.
 *
 * @throws {GwenContextError} If called outside an active engine context.
 *
 * @example
 * ```typescript
 * const bullet = usePrefab(BulletPrefab);
 * const id = bullet.spawn({ x: player.x, y: player.y });
 * // later:
 * bullet.despawn(id);
 * ```
 */
export function usePrefab(prefabDef: PrefabDefinition): PrefabHandle {
  const engine = useEngine();

  return {
    spawn(overrides: Record<string, unknown> = {}): bigint {
      const id = engine.createEntity();
      for (const { def, defaults } of prefabDef.components) {
        engine.addComponent(id, def as ComponentDefinition<ComponentSchema>, {
          ...defaults,
          ...overrides,
        });
      }
      return id;
    },

    despawn(id: bigint): void {
      engine.destroyEntity(id as unknown as EntityId);
    },
  };
}

// ─── useComponent ─────────────────────────────────────────────────────────────

/**
 * Returns an ES6 Proxy that transparently reads and writes the specified
 * component on the **current actor's entity**.
 *
 * Must be called synchronously inside a `defineActor()` factory function
 * (i.e. during actor spawn). The entity ID and engine reference are captured
 * in a closure at call time — subsequent property accesses inside `onUpdate`
 * or other frame callbacks use the captured references without requiring an
 * active engine context.
 *
 * **Read** — `proxy.prop` calls `engine.getComponent(entityId, def)` and
 * returns the named field.
 *
 * **Write** — `proxy.prop = value` calls `engine.addComponent(entityId, def,
 * { ...current, prop: value })`, merging the new value with the existing data.
 *
 * **Performance note** — The Proxy object itself is created **once** at spawn
 * time and stored in the actor factory's closure; there is no per-frame
 * overhead from the Proxy wrapper. However, every **property write**
 * (`proxy.x = value`) allocates a new plain object (`{ ...current, [prop]: value }`)
 * because the ECS component model is immutable: `addComponent` always replaces
 * the whole component data record. If your actor writes multiple fields per
 * frame from a hot path, batch them into a single `engine.addComponent()` call
 * to reduce allocation pressure:
 *
 * ```typescript
 * // ❌ Two allocations per frame:
 * pos.x += vx * dt;
 * pos.y += vy * dt;
 *
 * // ✅ One allocation per frame:
 * const cur = engine.getComponent(entityId, Position);
 * engine.addComponent(entityId, Position, { x: cur.x + vx * dt, y: cur.y + vy * dt });
 * ```
 *
 * @performance Property writes via this Proxy each create one object allocation
 *   (the spread merge). Batch writes with direct `engine.addComponent()` calls
 *   in hot paths to avoid per-property GC pressure.
 *
 *   when the component definition is not fully typed).
 * @param def - The component definition to target.
 * @returns A mutable proxy typed as `T`.
 *
 * @throws {Error} If called outside an active actor spawn context.
 *
 * @example
 * ```typescript
 * const Actor = defineActor(PosPrefab, () => {
 *   const pos = useComponent<{ x: number; y: number }>(Position);
 *   onUpdate((dt) => {
 *     pos.x += 100 * dt; // writes via addComponent
 *     console.log(pos.y); // reads via getComponent
 *   });
 * });
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useComponent<T extends Record<string, any> = Record<string, any>>(def: unknown): T {
  // Capture both entity ID and engine at factory-call time.
  // These are set by _withActorContext during spawn() and are valid here.
  const entityId = _getActorEntityId();
  const engine = _getActorEngine();

  /** Typed shorthand for the unsafe cast needed by the engine API. */
  const typedDef = def as ComponentDefinition<ComponentSchema>;

  return new Proxy({} as T, {
    get(_target: T, prop: string | symbol): unknown {
      if (typeof prop !== 'string') return undefined;
      const comp = engine.getComponent(entityId as unknown as EntityId, typedDef) as
        | Record<string, unknown>
        | undefined;
      return comp?.[prop];
    },

    set(_target: T, prop: string | symbol, value: unknown): boolean {
      if (typeof prop !== 'string') return false;
      const current =
        (engine.getComponent(entityId as unknown as EntityId, typedDef) as Record<
          string,
          unknown
        >) ?? {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      engine.addComponent(entityId as unknown as EntityId, typedDef, {
        ...current,
        [prop]: value,
      } as any);
      return true;
    },
  }) as T;
}

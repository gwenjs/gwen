/**
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

import { useEngine } from "../../engine/context";
import { _getActorEntityId, _getActorEngine } from "../defines/define-actor";
import { _registerScenePlugin } from "../../scene/scene-context";
import type { ActorDefinition, PrefabDefinition } from "../types";
import type { ComponentDefinition, ComponentSchema } from "../../schema";
import type { EntityId } from "../../engine/engine-api";

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
   * When `Props` is `void` no argument is needed.
   * When `Props` is a concrete type the props argument is required.
   *
   * @returns The ECS entity ID of the new instance.
   */
  spawn(...args: Props extends void ? [] : [props: Props]): EntityId;

  /**
   * Despawn the actor instance with the given entity ID.
   *
   * @param id - Entity ID returned by `spawn`.
   */
  despawn(id: EntityId): void;

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
   * When `Props` is `void` no argument is needed.
   * When `Props` is a concrete type the props argument is required.
   *
   * @returns The singleton instance's entity ID.
   */
  spawnOnce(...args: Props extends void ? [] : [props: Props]): EntityId;
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
  spawn(overrides?: Record<string, unknown>): EntityId;

  /**
   * Destroy the entity with the given ID.
   *
   * @param id - Entity ID returned by `spawn`.
   */
  despawn(id: EntityId): void;
}

/** @internal Methods on `ActorHandle` that take priority over `PublicAPI` in the Proxy. */
const HANDLE_OWN_KEYS = new Set<string>([
  "spawn",
  "despawn",
  "despawnAll",
  "count",
  "get",
  "getAll",
  "spawnOnce",
]);

// ─── useActor ─────────────────────────────────────────────────────────────────

/**
 * Returns a typed handle for spawning and managing instances of the given actor,
 * combined with a Proxy that delegates `PublicAPI` method calls to the first
 * live instance.
 *
 * The combined type `ActorHandle<Props, PublicAPI> & PublicAPI` allows passing
 * the result directly to a system parameter typed as `PublicAPI`, enabling
 * dependency injection without the `.get()?.method()` indirection.
 *
 * **Priority rule:** `ActorHandle` methods (`spawn`, `despawn`, `despawnAll`,
 * `count`, `get`, `getAll`, `spawnOnce`) take precedence over any `PublicAPI`
 * method with the same name. If a collision exists, rename the `PublicAPI` method.
 *
 * Must be called inside an active engine context (e.g. `engine.run()`, a plugin
 * `setup()` callback, or a `defineSystem()` factory).
 *
 * @param actorDef - The actor definition produced by `defineActor()`.
 * @returns A Proxy implementing both `ActorHandle<Props, PublicAPI>` and `PublicAPI`.
 *
 * @throws {GwenContextError} If called outside an active engine context.
 *
 * @example
 * ```typescript
 * // In scene factory:
 * const player = useActor(PlayerActor)
 *
 * // Pass to a DI system — typed as PlayerAPI at call site:
 * useSystem(CombatSystem(player))
 *
 * // Direct ActorHandle usage:
 * onEnter(() => player.spawnOnce({ x: 400, y: 530 }))
 * onExit(() => player.despawnAll())
 * ```
 */
export function useActor<Props, PublicAPI>(
  actorDef: ActorDefinition<Props, PublicAPI>,
): ActorHandle<Props, PublicAPI> & (PublicAPI extends void ? unknown : PublicAPI) {
  useEngine();
  _registerScenePlugin(actorDef._plugin);

  // Propagate child actor plugins injected by the Vite transform.
  // _deps is undefined in test environments where no transform runs.
  if (actorDef._plugin._deps) {
    for (const dep of actorDef._plugin._deps) {
      _registerScenePlugin(dep);
    }
  }

  let _singletonId: EntityId | undefined;

  const baseHandle: ActorHandle<Props, PublicAPI> = {
    spawn(props?: Props): EntityId {
      return (actorDef._plugin.spawn as (props?: Props) => EntityId)(props);
    },

    despawn(id: EntityId): void {
      if (_singletonId === id) _singletonId = undefined;
      actorDef._plugin.despawn(id);
    },

    despawnAll(): void {
      _singletonId = undefined;
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

    spawnOnce(props?: Props): EntityId {
      if (_singletonId !== undefined && actorDef._instances.has(_singletonId)) {
        return _singletonId;
      }
      _singletonId = (actorDef._plugin.spawn as (props?: Props) => EntityId)(props);
      return _singletonId;
    },
  };

  // Proxy: ActorHandle methods take priority; everything else delegates to PublicAPI.
  return new Proxy(baseHandle as object, {
    get(target, prop: string | symbol): unknown {
      // Priority 1: ActorHandle own methods
      if (typeof prop === "string" && HANDLE_OWN_KEYS.has(prop)) {
        return (target as Record<string, unknown>)[prop];
      }

      // Priority 2: PublicAPI property / method delegation
      if (typeof prop === "string") {
        const api = actorDef._instances.values().next().value?.api as
          | Record<string, unknown>
          | undefined;
        if (!api) return () => undefined;
        const value = api[prop];
        if (typeof value === "function") {
          return (...args: unknown[]): unknown =>
            (value as (...a: unknown[]) => unknown).apply(api, args);
        }
        return value;
      }

      // Fallback: symbol or unknown prop
      return (target as Record<string | symbol, unknown>)[prop];
    },
  }) as ActorHandle<Props, PublicAPI> & (PublicAPI extends void ? unknown : PublicAPI);
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
    spawn(overrides: Record<string, unknown> = {}): EntityId {
      const id = engine.createEntity();
      for (const { def, defaults } of prefabDef.components) {
        engine.addComponent(id, def as ComponentDefinition<ComponentSchema>, {
          ...defaults,
          ...overrides,
        });
      }
      return id;
    },

    despawn(id: EntityId): void {
      engine.destroyEntity(id);
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
 * @returns A mutable proxy typed as `T & { $set(values: Partial<T>): void }`.
 *
 * @throws {Error} If called outside an active actor spawn context.
 *
 * @example
 * ```typescript
 * const Actor = defineActor(PosPrefab, () => {
 *   const pos = useComponent<{ x: number; y: number }>(Position);
 *   onUpdate((dt) => {
 *     // Single-field write — one allocation:
 *     pos.x += 100 * dt;
 *
 *     // Batch write — one allocation regardless of field count:
 *     pos.$set({ x: pos.x + 100 * dt, y: pos.y + 50 * dt });
 *   });
 * });
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useComponent<T extends Record<string, any> = Record<string, any>>(
  def: unknown,
): T & { $set(values: Partial<T>): void } {
  // Capture both entity ID and engine at factory-call time.
  // These are set by _withActorContext during spawn() and are valid here.
  const entityId = _getActorEntityId();
  const engine = _getActorEngine();

  /** Typed shorthand for the unsafe cast needed by the engine API. */
  const typedDef = def as ComponentDefinition<ComponentSchema>;

  return new Proxy({} as T, {
    get(_target: T, prop: string | symbol): unknown {
      /**
       * `$set(values)` — batch-writes multiple component fields in a single
       * `addComponent` call, producing one object allocation instead of one
       * per property. Prefer this over repeated property assignments in hot
       * paths (e.g. position updates inside `onUpdate`).
       *
       * @example
       * ```ts
       * // ❌ Two allocations per frame:
       * pos.x += vx * dt;
       * pos.y += vy * dt;
       *
       * // ✅ One allocation per frame:
       * pos.$set({ x: pos.x + vx * dt, y: pos.y + vy * dt });
       * ```
       */
      if (prop === "$set") {
        return (values: Partial<T>) => {
          const current =
            (engine.getComponent(entityId, typedDef) as Record<string, unknown>) ?? {};
          engine.addComponent(entityId, typedDef, {
            ...current,
            ...(values as Record<string, unknown>),
          } as any);
        };
      }

      if (typeof prop !== "string") return undefined;
      const comp = engine.getComponent(entityId, typedDef) as Record<string, unknown> | undefined;
      return comp?.[prop];
    },

    set(_target: T, prop: string | symbol, value: unknown): boolean {
      if (typeof prop !== "string") return false;
      const current = (engine.getComponent(entityId, typedDef) as Record<string, unknown>) ?? {};
      engine.addComponent(entityId, typedDef, {
        ...current,
        [prop]: value,
      } as any);
      return true;
    },
  }) as T & { $set(values: Partial<T>): void };
}

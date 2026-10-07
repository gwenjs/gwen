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
import { _getActorEntityId, _getActorEngine } from "./define-actor";
import { SCENE_REGISTRAR_KEY } from "../../scene/runtime/scene-registrar";
import { GwenScope } from "../../context/scope.js";
import type { ActorDefinition, PrefabDefinition } from "./types";
import type { PrefabOverrides } from "./define-prefab";
import type { InferComponent } from "../../schema";
import type { ComponentDef } from "../../system/runtime/define-system";
import { useComponentFor } from "../../system/runtime/use-component";
import { spawnActor } from "./spawn-tuple";
import type { EntityId } from "../../engine/engine-api";
import { GwenActorError, ActorErrorCodes } from "../../engine/engine-errors";

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

  /**
   * Allows iterating over all live instances with `for...of`.
   *
   * Re-evaluated on every iteration — reflects the current set of live instances
   * at the time of the loop, not at the time the handle was obtained.
   *
   * @returns An iterator over the public APIs of all live instances.
   *
   * @example
   * ```ts
   * for (const unit of selectedUnits) {
   *   unit.moveTo(targetX, targetY)
   * }
   * ```
   */
  [Symbol.iterator](): IterableIterator<PublicAPI>;
}

/**
 * Handle returned by {@link usePrefab}.
 * Provides `spawn` / `despawn` helpers for a prefab-backed entity without actor behaviour.
 */
export interface PrefabHandle<E extends readonly ComponentDef[]> {
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
  spawn(overrides?: PrefabOverrides<E>): EntityId;

  /**
   * Destroy the entity with the given ID.
   *
   * @param id - Entity ID returned by `spawn`.
   */
  despawn(id: EntityId): void;
}

/** @internal Methods on `ActorHandle` that take priority over `PublicAPI` in the Proxy. */
const _HANDLE_OWN_KEYS = new Set<string>([
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
 * The handle keeps that engine. Every handle method runs on it, even when
 * another engine is current or none is.
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
  const engine = useEngine();
  try {
    const registrar = engine.inject(SCENE_REGISTRAR_KEY);
    registrar.register(actorDef._plugin);
    if (actorDef._plugin._deps) {
      for (const dep of actorDef._plugin._deps) {
        registrar.register(dep);
      }
    }
  } catch {
    // No scene:registrar available (e.g. called in a non-scene context such as a
    // plugin setup or direct engine.run()). This is valid — the actor plugin was
    // already installed externally.
  }

  let _singletonId: EntityId | undefined;
  const _methodCache = new Map<string, (...args: unknown[]) => unknown>();

  /** Every handle call runs on the engine the handle was created on. */
  const onOwnEngine = <T>(fn: () => T): T => engine.run(fn);

  const baseHandle: ActorHandle<Props, PublicAPI> = {
    spawn(props?: Props): EntityId {
      return onOwnEngine(() => spawnActor(actorDef._plugin, props));
    },

    despawn(id: EntityId): void {
      if (_singletonId === id) {
        _singletonId = undefined;
        _methodCache.clear();
      }
      onOwnEngine(() => actorDef._plugin.despawn(id));
    },

    despawnAll(): void {
      _singletonId = undefined;
      _methodCache.clear();
      onOwnEngine(() => {
        for (const id of Array.from(actorDef._instances.keys())) {
          actorDef._plugin.despawn(id);
        }
      });
    },

    count(): number {
      return onOwnEngine(() => actorDef._instances.size);
    },

    get(): PublicAPI | undefined {
      return onOwnEngine(() => actorDef._instances.values().next().value?.api);
    },

    getAll(): PublicAPI[] {
      return onOwnEngine(() => {
        const result: PublicAPI[] = [];
        for (const instance of actorDef._instances.values()) {
          result.push(instance.api!);
        }
        return result;
      });
    },

    [Symbol.iterator](): IterableIterator<PublicAPI> {
      return baseHandle.getAll().values();
    },

    spawnOnce(props?: Props): EntityId {
      return onOwnEngine(() => {
        if (_singletonId !== undefined && actorDef._instances.has(_singletonId)) {
          return _singletonId;
        }
        _singletonId = spawnActor(actorDef._plugin, props);
        return _singletonId;
      });
    },
  };

  // Auto-cleanup: despawn live instances when the enclosing scene exits.
  // Mirrors the pattern used by useActorPool — scoped to the active GwenScope so
  // the hook is removed as soon as the scene's scope is disposed.
  const scope = GwenScope.current();
  if (scope) {
    scope.hook("scene:beforeLeave", () => {
      const n = actorDef._instances.size;
      if (n > 0) {
        if (__GWEN_DEV__ && engine.debug) {
          engine.logger.warn(
            `[auto-cleanup] ${n} instance(s) of "${actorDef._plugin.name}" were not despawned ` +
              `before scene exit — cleaned up automatically. ` +
              `Add onExit(() => actor.despawnAll()) to silence this warning.`,
          );
        }
        baseHandle.despawnAll();
      }
    });
  }

  // Proxy: ActorHandle methods take priority; everything else delegates to PublicAPI.
  return new Proxy(baseHandle as object, {
    get(target, prop: string | symbol): unknown {
      // Priority 1: ActorHandle own methods
      if (typeof prop === "string" && _HANDLE_OWN_KEYS.has(prop)) {
        return (target as Record<string, unknown>)[prop];
      }

      // Priority 2: PublicAPI property / method delegation
      if (typeof prop === "string") {
        // Check cache first for PublicAPI methods
        const cached = _methodCache.get(prop);
        if (cached) return cached;

        const api = baseHandle.get() as Record<string, unknown> | undefined;
        if (!api) {
          return () => {
            throw new GwenActorError(
              ActorErrorCodes.NO_LIVE_INSTANCE,
              `[GWEN] useActor(${actorDef.__actorName__}) — no live instance. ` +
                `Spawn an instance before calling PublicAPI methods via the handle proxy.\n` +
                `  Handle methods (spawn, despawn, count, get, getAll, despawnAll, spawnOnce) ` +
                `are always available regardless of instance state.`,
            );
          };
        }
        const value = api[prop];
        if (typeof value === "function") {
          const wrapped = (...args: unknown[]): unknown =>
            (value as (...a: unknown[]) => unknown).apply(api, args);
          _methodCache.set(prop, wrapped);
          return wrapped;
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
export function usePrefab<E extends readonly ComponentDef[]>(
  prefabDef: PrefabDefinition<E>,
): PrefabHandle<E> {
  const engine = useEngine();

  return {
    spawn(overrides: PrefabOverrides<E> = {}): EntityId {
      const id = engine.createEntity();
      for (const entry of prefabDef.components) {
        engine.addComponent(id, entry.def, {
          ...entry.defaults,
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
 *   const pos = useComponent(Position);
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
export function useComponent<D extends ComponentDef>(
  def: D,
): InferComponent<D> & { $set(patch: Partial<InferComponent<D>>): void } {
  return useComponentFor(_getActorEntityId(), def, _getActorEngine());
}

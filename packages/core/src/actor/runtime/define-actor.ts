/**
 * Implements the actor system: a composable, instance-based alternative to
 * `defineSystem()`. Each actor owns its own ECS entity, runs lifecycle hooks
 * per instance, and exposes a public API for inter-actor communication.
 *
 * Architecture:
 * - `defineActor(prefab, factory)` → `ActorDefinition` (plugin + instance registry)
 * - `spawn(props?)` creates an entity, runs the factory inside both the actor
 *   context and the system context, then calls `_start` callbacks immediately.
 * - `despawn(entityId)` calls `_destroy`, runs event cleanups, then destroys the entity.
 * - Lifecycle composables (`onStart`, `onDestroy`) read from the
 *   module-level actor context set during `spawn`.
 * - Frame-phase composables (`onUpdate`, `onBeforeUpdate`, `onAfterUpdate`,
 *   `onRender`) work via `GwenScope.current()` unified context system.
 *
 * @example
 * ```typescript
 * export const EnemyActor = defineActor(EnemyPrefab, (props: { hp: number }) => {
 *   onStart(() => console.log('enemy spawned'))
 *   onDestroy(() => console.log('enemy destroyed'))
 *   onUpdate((dt) => { ... })
 *   return { takeDamage: (amount: number) => { ... } }
 * })
 *
 * // In a system:
 * await engine.use(EnemyActor._plugin)
 * const id = EnemyActor._plugin.spawn({ hp: 100 })
 * // later...
 * EnemyActor._plugin.despawn(id)
 * ```
 */

import { useEngine } from "../../engine/context.js";
import type { GwenEngine } from "../../engine/gwen-engine";
import type { GwenEngineBase } from "@gwenjs/schema";
import type { EntityId } from "../../engine/engine-api";
import { GwenActorError, ActorErrorCodes } from "../../engine/engine-errors";
import type { IGwenLogger } from "@gwenjs/schema";
import type {
  ActorDefinition,
  ActorInstance,
  ActorPlugin,
  PrefabDefinition,
  VoidFn,
} from "./types";
import { GwenComposableError, ComposableErrorCodes } from "../../engine/engine-errors";
import { ScopedHookable } from "../../hooks/scoped-hookable";
import { engineContext } from "../../engine/context";
import { ContextSlot } from "../../engine/context-slot";
import { GwenScope } from "../../context/scope.js";

// ─── Module-level actor context ───────────────────────────────────────────────

/**
 * Snapshot of a single actor spawn context: the three values that composables
 * read during a `defineActor()` factory call.
 *
 * Storing them as one object prevents partial-save bugs where only one or two
 * variables are restored after a throwing factory.
 *
 * @internal
 */
interface ActorContext {
  entityId: EntityId;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  instance: ActorInstance<any>;
  engine: GwenEngine;
}

/**
 * Slot containing the active actor context, or `null` when no factory is running.
 * Updated atomically via {@link ContextSlot.run}.
 * @internal
 */
const _actorCtx = new ContextSlot<ActorContext>();

/**
 * Maps ActorInstance to its GwenScope for cleanup during despawn.
 * @internal
 */
const _actorScopes = new WeakMap<ActorInstance<unknown>, GwenScope>();

/**
 * Maps every live entity ID to its actor plugin.
 * Used by `useChildren()` to cascade `despawn()` without knowing the actor type.
 * @internal
 */
export const _actorRegistry = new Map<EntityId, ActorPlugin<unknown>>();

/**
 * Maps every live entity ID to its `ActorInstance`.
 * Used by `useChildren()` to update `_children` when ownership is transferred.
 * @internal
 */
export const _instanceRegistry = new Map<EntityId, ActorInstance<unknown>>();

/**
 * Maps a child entity ID to its current owner's entity ID.
 * Used to clean up `_children` when a child is directly despawned.
 * @internal
 */
export const _ownerRegistry = new Map<EntityId, EntityId>();

/**
 * Maps a pooled entity ID to the pool's `release` function.
 * Populated by `define-actor-pool.ts` on slot creation.
 * Used in `_doRelease()` to release pooled children instead of despawning them.
 * @internal
 */
export const _poolReleaseRegistry = new Map<EntityId, (id: EntityId) => void>();

// ─── Actor context helpers ────────────────────────────────────────────────────

/**
 * Returns the entity ID of the actor currently being spawned.
 *
 * @returns The active actor's entity ID as a `EntityId`.
 * @throws {Error} If called outside an active actor spawn context.
 * @internal
 */
export function _getActorEntityId(): EntityId {
  const ctx = _actorCtx.get();
  if (ctx === null) {
    throw new GwenComposableError(
      ComposableErrorCodes.OUTSIDE_ACTOR_CONTEXT,
      "[GWEN] _getActorEntityId() must be called inside a defineActor() factory function. " +
        "It is only valid during actor spawn.",
    );
  }
  return ctx.entityId;
}

/**
 * Returns the ECS entity ID of the actor currently being set up.
 *
 * Call this inside a `defineActor()` factory (or inside a composable called
 * from one) to obtain the `EntityId` identifier that uniquely names this actor
 * instance in the ECS world. The value is stable for the entire lifetime of
 * the actor — from spawn to despawn.
 *
 * ### When to use
 *
 * Use `useEntityId()` when a composable needs to key a per-instance resource
 * to the specific actor being spawned. The canonical example is a renderer
 * composable that must allocate a unique slot:
 *
 * ```ts
 * // Composable for a renderer plugin
 * export function useSprite(src: string): SpriteHandle {
 *   const id = useEntityId()
 *   const service = useService('renderer:canvas')
 *   const sprite = service.allocateSprite(String(id), src)
 *   onCleanup(() => sprite.destroy())
 *   return sprite
 * }
 * ```
 *
 * For singleton actors (HUD, score display…) a plain static string key is
 * simpler and preferred:
 *
 * ```ts
 * // ✅ Singleton — static key is clearest
 * export const HudActor = defineActor(HudPrefab, () => {
 *   const hud = useHTML('hud', 'score')
 * })
 *
 * // ✅ Multiple instances — entity ID guarantees a unique slot per actor
 * export const EnemyActor = defineActor(EnemyPrefab, () => {
 *   const id = useEntityId()
 *   const label = useHTML('ui', String(id))
 * })
 * ```
 *
 * ### Context requirement
 *
 * `useEntityId()` must be called during the **setup phase** of a
 * `defineActor()` factory — i.e., at the top level of the factory function,
 * not inside `onStart`, `onUpdate`, or other callbacks. Violating this throws
 * at runtime.
 *
 * @returns The `EntityId` entity ID for the actor being set up.
 * @throws {Error} If called outside an active `defineActor()` factory context.
 */
export function useEntityId(): EntityId {
  const ctx = _actorCtx.get();
  if (ctx === null) {
    throw new GwenComposableError(
      ComposableErrorCodes.OUTSIDE_ACTOR_CONTEXT,
      "[GWEN] useEntityId() must be called inside a defineActor() factory function. " +
        "It is only valid during actor spawn.",
    );
  }
  return ctx.entityId;
}

/**
 * Returns the full actor context (entityId + instance + engine) for the currently
 * spawning actor, or `null` if no factory is running.
 *
 * @internal Used by composables that need access to the full actor context.
 */
export function _getActorContext(): {
  entityId: EntityId;
  instance: ActorInstance<unknown>;
  engine: GwenEngine;
} | null {
  return _actorCtx.get() as {
    entityId: EntityId;
    instance: ActorInstance<unknown>;
    engine: GwenEngine;
  } | null;
}

/**
 * Returns the engine of the actor currently being spawned.
 *
 * @returns The active engine.
 * @throws {Error} If called outside an active actor spawn context.
 * @internal
 */
export function _getActorEngine(): GwenEngine {
  const ctx = _actorCtx.get();
  if (ctx === null) {
    throw new GwenComposableError(
      ComposableErrorCodes.OUTSIDE_ACTOR_CONTEXT,
      "[GWEN] _getActorEngine() must be called inside a defineActor() factory function. " +
        "It is only valid during actor spawn.",
    );
  }
  return ctx.engine;
}

// ─── Actor-level lifecycle composables ────────────────────────────────────────

/**
 * Registers a callback to run **once**, immediately after the actor is spawned.
 *
 * Must be called synchronously inside a {@link defineActor} factory function.
 *
 * @param fn - The callback to invoke on actor start.
 * @throws {Error} If called outside an active actor factory.
 *
 * @example
 * ```typescript
 * defineActor(MyPrefab, () => {
 *   onStart(() => console.log('actor started'))
 * })
 * ```
 */
export function onStart(fn: VoidFn): void {
  const ctx = _actorCtx.get();
  if (ctx === null) {
    throw new GwenComposableError(
      ComposableErrorCodes.OUTSIDE_ACTOR_CONTEXT,
      "[GWEN] onStart() must be called synchronously inside a defineActor() factory function.",
    );
  }
  ctx.instance._start.push(fn);
}

/**
 * Registers a callback to run **once** when the actor is despawned.
 *
 * Must be called synchronously inside a {@link defineActor} factory function.
 *
 * @param fn - The callback to invoke on actor destruction.
 * @throws {Error} If called outside an active actor factory.
 *
 * @example
 * ```typescript
 * defineActor(MyPrefab, () => {
 *   onDestroy(() => console.log('actor destroyed'))
 * })
 * ```
 */
export function onDestroy(fn: VoidFn): void {
  const ctx = _actorCtx.get();
  if (ctx === null) {
    throw new GwenComposableError(
      ComposableErrorCodes.OUTSIDE_ACTOR_CONTEXT,
      "[GWEN] onDestroy() must be called synchronously inside a defineActor() factory function.",
    );
  }
  ctx.instance._destroy.push(fn);
}

/**
 * Registers a callback invoked when this actor instance is returned to a pool
 * via `pool.release(id)`. Use it to clean up external state such as physics
 * bodies, audio, or tweens. Not called by `despawn()`.
 *
 * Must be called synchronously inside a `defineActor()` factory function.
 *
 * @param fn - Callback invoked on pool release.
 */
export function onRelease(fn: VoidFn): void {
  const ctx = _actorCtx.get();
  if (ctx === null) {
    throw new GwenComposableError(
      ComposableErrorCodes.OUTSIDE_ACTOR_CONTEXT,
      "[GWEN] onRelease() must be called synchronously inside a defineActor() factory function.",
    );
  }
  ctx.instance._release.push(fn);
}

/**
 * Registers a callback invoked when this actor instance is reacquired from a
 * pool via `pool.acquire(props)`. Use it to reset component data and any
 * internal state using the new props. Called after prefab defaults are
 * re-applied automatically.
 *
 * Must be called synchronously inside a `defineActor()` factory function.
 *
 * @param fn - Callback receiving the new props passed to `acquire()`.
 * @template Props - The props type inferred from `defineActor`.
 */
export function onReset<Props = unknown>(fn: (props: Props) => void): void {
  const ctx = _actorCtx.get();
  if (ctx === null) {
    throw new GwenComposableError(
      ComposableErrorCodes.OUTSIDE_ACTOR_CONTEXT,
      "[GWEN] onReset() must be called synchronously inside a defineActor() factory function.",
    );
  }
  ctx.instance._reset.push(fn as (props: unknown) => void);
}

/**
 * Registers a callback fired when this actor's scope is resumed — either
 * because the actor was re-acquired from a pool via `pool.acquire()` or
 * because `scope.resume()` was called explicitly.
 *
 * Use this to reset visual or audio state when a pooled actor becomes active
 * again. Called after `onReset` when re-acquiring from a pool.
 *
 * Must be called synchronously inside a `defineActor()` factory function.
 *
 * @param fn - Callback invoked when the actor is enabled.
 */
export function onEnable(fn: VoidFn): void {
  const ctx = _actorCtx.get();
  if (ctx === null) {
    throw new GwenComposableError(
      ComposableErrorCodes.OUTSIDE_ACTOR_CONTEXT,
      "[GWEN] onEnable() must be called synchronously inside a defineActor() factory function.",
    );
  }
  ctx.instance._enable.push(fn);
}

/**
 * Registers a callback fired when this actor's scope is paused — either
 * because the actor was returned to a pool via `pool.release()` or because
 * `scope.pause()` was called explicitly.
 *
 * Use this to clean up or hide visual state when a pooled actor becomes
 * dormant. Called before `onRelease` when releasing to a pool.
 *
 * Must be called synchronously inside a `defineActor()` factory function.
 *
 * @param fn - Callback invoked when the actor is disabled.
 */
export function onDisable(fn: VoidFn): void {
  const ctx = _actorCtx.get();
  if (ctx === null) {
    throw new GwenComposableError(
      ComposableErrorCodes.OUTSIDE_ACTOR_CONTEXT,
      "[GWEN] onDisable() must be called synchronously inside a defineActor() factory function.",
    );
  }
  ctx.instance._disable.push(fn);
}

// ─── defineActor ─────────────────────────────────────────────────────────────

// ─── Module-level plugin name counter ─────────────────────────────────────────

/**
 * Monotonically-increasing counter used to generate unique plugin names for
 * `defineActor()` calls that do not provide an explicit name.
 *
 * The Vite transform injects the exported variable name as the first argument
 * automatically. In test environments or plain Node.js, the counter produces
 * stable names (`actor-1`, `actor-2`, …) that are unique per call site,
 * preventing `engine.use()` deduplication from silently discarding plugins.
 *
 * @internal
 */
let _actorPluginCounter = 0;

/**
 * Factory type accepted by {@link defineActor}.
 *
 * When `Props` is `void` the factory takes no arguments.
 * When `Props` is a concrete type the factory receives it as a required parameter
 * (spawn always provides it, so the factory can rely on it being defined).
 *
 * @template Props - Props forwarded from `spawn(props)`.
 * @template PublicAPI - The object returned by the factory (actor's public API).
 */
type ActorFactory<Props, PublicAPI> = Props extends void
  ? () => PublicAPI
  : (props: Props) => PublicAPI;

/**
 * Optional configuration for {@link defineActor}.
 *
 * @template Props     - Props type forwarded to `spawn()`.
 * @template PublicAPI - Public API type returned by the factory.
 */
export interface DefineActorOptions<
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  Props = void,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  PublicAPI = void,
> {
  /**
   * Child actor definitions this actor's factory depends on via `useActor()`.
   *
   * When provided, `useActor()` will register the corresponding plugins
   * automatically — exactly as the `@gwenjs/vite` transform does at build time.
   * Use this in test environments or any context where the Vite transform is
   * not active, to prevent silent dependency-registration mismatches between
   * development and test runs.
   *
   * @example
   * ```ts
   * export const EnemyActor = defineActor(EnemyPrefab, (props) => {
   *   const bullet = useActor(BulletActor);
   *   // ...
   * }, { deps: [BulletActor] });
   * ```
   */
  deps?: ActorDefinition<unknown, unknown>[];
}

/**
 * Defines an actor type: a composable, instance-based game object backed by a
 * single ECS entity per instance.
 *
 * @overload
 * Explicit name form — use without the Vite plugin (tests, Node.js scripts).
 * @param name    - Unique plugin name. Must be distinct across all `defineActor()` calls
 *                  registered with the same engine.
 * @param prefab  - Prefab defining the ECS component layout for this actor.
 * @param factory - Per-instance setup function. May register lifecycle callbacks
 *                  and return a public API object.
 * @param options - Optional configuration. Pass `{ deps: [...] }` to declare
 *                  child actor dependencies explicitly.
 */
export function defineActor<Props = void, PublicAPI = void>(
  name: string,
  prefab: PrefabDefinition,
  factory: ActorFactory<Props, PublicAPI>,
  options?: DefineActorOptions<Props, PublicAPI>,
): ActorDefinition<Props, PublicAPI>;
/**
 * @overload
 * Anonymous form — the Vite plugin injects the exported variable name automatically.
 * Without the Vite plugin, a stable counter-based name is generated (`actor-1`, `actor-2`, …).
 * @param prefab  - Prefab defining the ECS component layout for this actor.
 * @param factory - Per-instance setup function.
 * @param options - Optional configuration. Pass `{ deps: [...] }` to declare
 *                  child actor dependencies explicitly.
 */
export function defineActor<Props = void, PublicAPI = void>(
  prefab: PrefabDefinition,
  factory: ActorFactory<Props, PublicAPI>,
  options?: DefineActorOptions<Props, PublicAPI>,
): ActorDefinition<Props, PublicAPI>;
export function defineActor<Props = void, PublicAPI = void>(
  nameOrPrefab: string | PrefabDefinition,
  prefabOrFactory: PrefabDefinition | ActorFactory<Props, PublicAPI>,
  factoryOrOptions?: ActorFactory<Props, PublicAPI> | DefineActorOptions<Props, PublicAPI>,
  maybeOptions?: DefineActorOptions<Props, PublicAPI>,
): ActorDefinition<Props, PublicAPI> {
  const isNamedForm = typeof nameOrPrefab === "string";
  const pluginName = isNamedForm ? nameOrPrefab : `actor-${++_actorPluginCounter}`;
  const prefab = isNamedForm
    ? (prefabOrFactory as PrefabDefinition)
    : (nameOrPrefab as PrefabDefinition);

  // Resolve factory and options from the variable-arity overloads.
  let factory: ActorFactory<Props, PublicAPI>;
  let options: DefineActorOptions<Props, PublicAPI> | undefined;
  if (isNamedForm) {
    // (name, prefab, factory[, options])
    factory = factoryOrOptions as ActorFactory<Props, PublicAPI>;
    options = maybeOptions;
  } else {
    // (prefab, factory[, options])
    factory = prefabOrFactory as ActorFactory<Props, PublicAPI>;
    options = factoryOrOptions as DefineActorOptions<Props, PublicAPI> | undefined;
  }
  const _instances = new Map<EntityId, ActorInstance<PublicAPI>>();

  /** Real engine. The `setup` argument is a hooks proxy, and isolation is keyed on this object. */
  let _engine: GwenEngine | null = null;
  /** Logger scoped to this actor — set in `setup()`, used for cleanup error reporting. */
  let _log: IGwenLogger | null = null;

  // ─── spawn ───────────────────────────────────────────────────────────────

  function spawn(props?: Props): EntityId {
    if (!_engine) {
      throw new GwenActorError(
        ActorErrorCodes.PLUGIN_NOT_READY,
        "[GWEN] Actor.spawn() was called before the actor plugin was installed.\n" +
          "  Code: ACTOR:PLUGIN_NOT_READY\n\n" +
          "  Possible causes:\n" +
          "  1. spawn() was called directly inside a defineScene() factory body.\n" +
          "     Fix: wrap the call in onEnter(() => actor.spawnOnce(...)).\n" +
          "  2. spawn() was called from a system (e.g. SpawnSystem.onUpdate), but the\n" +
          "     actor was only declared inside defineSystem() — not in the scene factory.\n" +
          "     Fix: also call useActor(MyActor) inside the defineScene() factory that\n" +
          "     includes the system, so the plugin is auto-installed at bootstrap.",
      );
    }

    // 1. Create the ECS entity.
    const entityId = _engine.createEntity();

    // 2. Add prefab components with their declared defaults.
    for (let i = 0; i < prefab.components.length; i++) {
      const entry = prefab.components[i]!;
      _engine.addComponent(entityId, entry.def, entry.defaults);
    }

    // 3. Build a blank instance.
    const instance: ActorInstance<PublicAPI> = {
      entityId,
      _scope: new ScopedHookable(_engine!.hooks),
      _start: [],
      _destroy: [],
      _enable: [],
      _disable: [],
      _release: [],
      _reset: [],
      api: undefined as unknown as PublicAPI,
    };

    // 4. Create the actor scope (Phase 4 — GwenScope.current() support).
    // Pass instance._scope as the custom hookable so that hooks registered
    // via useHook() use the same _scope, enabling dormancy via pause/resume.
    const actorScope = new GwenScope(
      _engine!,
      {
        type: "actor",
        name: pluginName,
        entityId: instance.entityId,
      },
      null,
      instance._scope,
    );
    _actorScopes.set(instance, actorScope);

    // 5. Run the factory inside the actor context, scope slot, and GwenScope.
    //    Also activate the engine context so that composables like useHook()
    //    that call useEngine() work even when spawn() is called outside engine.run().
    //    Only set/unset the engine context when it is not already active — we must
    //    not clobber an outer engine.run() context.
    let api: PublicAPI | undefined;
    _actorCtx.run({ entityId: instance.entityId, instance, engine: _engine! }, () => {
      const needsEngineCtx = !engineContext.tryUse();
      if (needsEngineCtx) engineContext.set(_engine!);
      try {
        actorScope.run(() => {
          api = (factory as (props?: Props) => PublicAPI)(props);
        });
      } finally {
        if (needsEngineCtx) engineContext.unset();
      }
    });

    instance.api = api as PublicAPI;

    // 6. Register instance.
    _instances.set(entityId, instance);

    // Register in module-level lookup tables for useChildren() cascade.
    // Clear stale entries for this entity ID — IDs are reused across engine
    // instances in tests. A freshly spawned entity is never owned or pooled.
    _ownerRegistry.delete(entityId);
    _poolReleaseRegistry.delete(entityId);
    _actorRegistry.set(entityId, _plugin as ActorPlugin<unknown>);
    _instanceRegistry.set(entityId, instance as ActorInstance<unknown>);

    // 7. Fire _start callbacks immediately after setup.
    for (let i = 0; i < instance._start.length; i++) {
      instance._start[i]!();
    }
    instance._start = [];

    return entityId;
  }

  // ─── despawn ─────────────────────────────────────────────────────────────

  function despawn(entityId: EntityId): void {
    const instance = _instances.get(entityId);
    if (!instance) return;

    // ── Children cascade ────────────────────────────────────────────────────
    // Cascade despawn to all owned children before removing from registries.
    // Always full despawn (not pool release) because the parent is being destroyed.
    if (instance._children) {
      const childIds = [...instance._children];
      instance._children.clear(); // relinquish ownership before children despawn
      for (const childId of childIds) {
        _actorRegistry.get(childId)?.despawn(childId);
      }
    }

    // 1. Remove from registries FIRST (re-entrancy guard).
    _instances.delete(entityId);

    // 2. Call onDestroy callbacks.
    for (let i = 0; i < instance._destroy.length; i++) {
      try {
        instance._destroy[i]!();
      } catch (e) {
        _log?.error("onDestroy threw during despawn", { error: String(e) });
      }
    }

    // 3. Dispose the scope — unregisters all engine:update/render/etc handlers.
    instance._scope.dispose();

    // 4. Dispose the GwenScope (Phase 4).
    const actorScope = _actorScopes.get(instance);
    if (actorScope) {
      actorScope.dispose();
      _actorScopes.delete(instance);
    }

    // 5. Destroy the ECS entity.
    _engine?.destroyEntity(entityId as unknown as EntityId);

    // ── Registry cleanup ────────────────────────────────────────────────────
    // Resolve parent link before deleting own entries (ownerId !== entityId — no conflict).
    const ownerId = _ownerRegistry.get(entityId);
    _actorRegistry.delete(entityId);
    _instanceRegistry.delete(entityId);
    _poolReleaseRegistry.delete(entityId);

    if (ownerId !== undefined) {
      _ownerRegistry.delete(entityId);
      const ownerInstance = _instanceRegistry.get(ownerId);
      ownerInstance?._children?.delete(entityId);
    }
  }

  // ─── Plugin ───────────────────────────────────────────────────────────────

  const _plugin: ActorPlugin<Props> = {
    name: pluginName,

    // Populate _deps from the explicit `options.deps` when provided.
    // The Vite transform may later overwrite this with the injected array;
    // explicit options take precedence during the current module evaluation.
    _deps: options?.deps?.map((d) => d._plugin),

    setup(engine: GwenEngineBase): void {
      _engine = useEngine();
      _log = engine.logger.child(`actor:${pluginName}`);
    },

    spawn,
    despawn,
  };

  return {
    _plugin,
    _instances,
    _prefab: prefab,
    __actorName__: pluginName, // ← was "anonymous"
    __props__: undefined as unknown as Props,
    __api__: undefined as unknown as PublicAPI,
  };
}

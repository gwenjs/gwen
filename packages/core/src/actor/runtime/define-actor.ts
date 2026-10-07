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

import { engineContext, GwenContextError, useEngine } from "../../engine/context.js";
import { unwrapEngine } from "../../engine/engine-local.js";
import { createDisposable } from "../../disposable.js";
import type { GwenEngine } from "../../engine/gwen-engine";
import type { GwenEngineBase } from "@gwenjs/schema";
import type { EntityId } from "../../engine/engine-api";
import type { ComponentDef } from "../../system/runtime/define-system";
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
import { createEngineLocal, popEngine, pushEngine } from "../../engine/engine-local";
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
  instance: ActorInstance<unknown>;
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

export interface ActorTables {
  actors: Map<EntityId, ActorPlugin<unknown>>;
  instances: Map<EntityId, ActorInstance<unknown>>;
  owners: Map<EntityId, EntityId>;
  poolRelease: Map<EntityId, (id: EntityId) => void>;
}

const actorTables = createEngineLocal<ActorTables>(() => ({
  actors: new Map(),
  instances: new Map(),
  owners: new Map(),
  poolRelease: new Map(),
}));

/** Actor lookup tables for one engine. Entity ids are not unique across engines. */
export function actorTablesFor(engine: GwenEngine): ActorTables {
  return actorTables.get(engine);
}

/**
 * `ActorDefinition._instances` view.
 * Each engine has its own bucket. The same entity id on two engines does not collide.
 */
class DefinitionInstances<API> extends Map<EntityId, ActorInstance<API>> {
  constructor(
    private readonly buckets: WeakMap<GwenEngine, Map<EntityId, ActorInstance<API>>>,
    private readonly engines: Set<GwenEngine>,
  ) {
    super();
  }

  /**
   * Current engine only. One installed engine is used when none is current.
   *
   * @throws {GwenContextError} When no engine is current and the actor is
   *   installed on two or more engines: the read would have no owner.
   */
  private bucket(): Map<EntityId, ActorInstance<API>> | undefined {
    const current = engineContext.tryUse();
    if (current) return this.buckets.get(unwrapEngine(current));
    if (this.engines.size > 1) {
      throw new GwenContextError(
        "[GWEN] An actor installed on several engines was read with no engine current.\n" +
          "  Fix: read it inside engine.run(), or through a useActor() handle.",
      );
    }
    for (const engine of this.engines) return this.buckets.get(engine);
    return undefined;
  }

  private lookup(id: EntityId): ActorInstance<API> | undefined {
    return this.bucket()?.get(id);
  }

  override get(id: EntityId): ActorInstance<API> | undefined {
    return this.lookup(id);
  }

  override has(id: EntityId): boolean {
    return this.lookup(id) !== undefined;
  }

  override get size(): number {
    return this.bucket()?.size ?? 0;
  }

  override delete(id: EntityId): boolean {
    return this.bucket()?.delete(id) ?? false;
  }

  override set(id: EntityId, value: ActorInstance<API>): this {
    this.bucket()?.set(id, value);
    return this;
  }

  override clear(): void {
    this.bucket()?.clear();
  }

  override forEach(
    callback: (
      value: ActorInstance<API>,
      key: EntityId,
      map: Map<EntityId, ActorInstance<API>>,
    ) => void,
    thisArg?: unknown,
  ): void {
    const bucket = this.bucket();
    if (!bucket) return;
    for (const [key, value] of bucket) callback.call(thisArg, value, key, this);
  }

  override [Symbol.iterator](): MapIterator<[EntityId, ActorInstance<API>]> {
    return this.entries();
  }

  override *keys(): MapIterator<EntityId> {
    const bucket = this.bucket();
    if (bucket) yield* bucket.keys();
  }

  override *values(): MapIterator<ActorInstance<API>> {
    const bucket = this.bucket();
    if (bucket) yield* bucket.values();
  }

  override *entries(): MapIterator<[EntityId, ActorInstance<API>]> {
    const bucket = this.bucket();
    if (bucket) yield* bucket.entries();
  }
}

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
 * internal state using the new props. Called after component defaults, then
 * prefab defaults, are written into the existing components automatically.
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
  Props,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  PublicAPI,
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
export function defineActor<PublicAPI>(
  prefab: PrefabDefinition<readonly ComponentDef[]>,
  factory: () => PublicAPI,
  options?: DefineActorOptions<void, PublicAPI>,
): ActorDefinition<void, PublicAPI>;
export function defineActor<Props, PublicAPI>(
  prefab: PrefabDefinition<readonly ComponentDef[]>,
  factory: (props: Props) => PublicAPI,
  options?: DefineActorOptions<Props, PublicAPI>,
): ActorDefinition<Props, PublicAPI>;
export function defineActor<PublicAPI>(
  name: string,
  prefab: PrefabDefinition<readonly ComponentDef[]>,
  factory: () => PublicAPI,
  options?: DefineActorOptions<void, PublicAPI>,
): ActorDefinition<void, PublicAPI>;
export function defineActor<Props, PublicAPI>(
  name: string,
  prefab: PrefabDefinition<readonly ComponentDef[]>,
  factory: (props: Props) => PublicAPI,
  options?: DefineActorOptions<Props, PublicAPI>,
): ActorDefinition<Props, PublicAPI>;
export function defineActor<Props, PublicAPI>(
  nameOrPrefab: string | PrefabDefinition<readonly ComponentDef[]>,
  prefabOrFactory:
    | PrefabDefinition<readonly ComponentDef[]>
    | ActorFactory<Props, PublicAPI>
    | (() => PublicAPI),
  factoryOrOptions?:
    | ActorFactory<Props, PublicAPI>
    | (() => PublicAPI)
    | DefineActorOptions<Props, PublicAPI>,
  maybeOptions?: DefineActorOptions<Props, PublicAPI>,
): ActorDefinition<Props, PublicAPI> {
  const isNamedForm = typeof nameOrPrefab === "string";
  const pluginName = isNamedForm ? nameOrPrefab : `actor-${++_actorPluginCounter}`;
  const prefab = isNamedForm
    ? (prefabOrFactory as PrefabDefinition<readonly ComponentDef[]>)
    : (nameOrPrefab as PrefabDefinition<readonly ComponentDef[]>);

  let factory: ActorFactory<Props, PublicAPI> | (() => PublicAPI);
  let options: DefineActorOptions<Props, PublicAPI> | undefined;
  if (isNamedForm) {
    factory = factoryOrOptions as ActorFactory<Props, PublicAPI>;
    options = maybeOptions;
  } else {
    factory = prefabOrFactory as ActorFactory<Props, PublicAPI>;
    options = factoryOrOptions as DefineActorOptions<Props, PublicAPI> | undefined;
  }
  const _buckets = new WeakMap<GwenEngine, Map<EntityId, ActorInstance<PublicAPI>>>();
  const _engines = new Set<GwenEngine>();
  const _instances = new DefinitionInstances<PublicAPI>(_buckets, _engines);

  function bucketFor(engine: GwenEngine): Map<EntityId, ActorInstance<PublicAPI>> {
    const existing = _buckets.get(engine);
    if (existing) return existing;
    const created = new Map<EntityId, ActorInstance<PublicAPI>>();
    _buckets.set(engine, created);
    return created;
  }

  function resolveEngine(): GwenEngine {
    const current = engineContext.tryUse();
    if (current) {
      const real = unwrapEngine(current);
      if (_engines.has(real)) return real;
    } else if (_engines.size === 1) {
      for (const only of _engines) return only;
    }
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
        "     includes the system, so the plugin is auto-installed at bootstrap.\n" +
        "  3. The same actor is installed on more than one engine.\n" +
        "     Fix: call spawn() inside engine.run() so the engine is current.\n" +
        "  4. The current engine does not have this actor installed.\n" +
        "     Fix: install it on that engine, or spawn inside the run() of the engine that has it.",
    );
  }

  function engineOwning(entityId: EntityId): GwenEngine | null {
    const current = engineContext.tryUse();
    if (current) {
      const real = unwrapEngine(current);
      return _buckets.get(real)?.has(entityId) ? real : null;
    }
    if (_engines.size !== 1) return null;
    for (const engine of _engines) {
      if (_buckets.get(engine)?.has(entityId)) return engine;
    }
    return null;
  }
  /** Logger scoped to this actor — set in `setup()`, used for cleanup error reporting. */
  let _log: IGwenLogger | null = null;

  // ─── spawn ───────────────────────────────────────────────────────────────

  function spawn(props?: Props): EntityId {
    const engine = resolveEngine();

    // 1. Create the ECS entity.
    const entityId = engine.createEntity();

    // 2. Add prefab components with their declared defaults.
    for (let i = 0; i < prefab.components.length; i++) {
      const entry = prefab.components[i]!;
      engine.addComponent(entityId, entry.def, entry.defaults);
    }

    // 3. Build a blank instance.
    const instance: ActorInstance<PublicAPI> = {
      entityId,
      _scope: new ScopedHookable(engine.hooks),
      _start: [],
      _destroy: [],
      _enable: [],
      _disable: [],
      _release: [],
      _reset: [],
      api: undefined,
    };

    // 4. Create the actor scope (Phase 4 — GwenScope.current() support).
    // Pass instance._scope as the custom hookable so that hooks registered
    // via useHook() use the same _scope, enabling dormancy via pause/resume.
    const actorScope = new GwenScope(
      engine,
      {
        type: "actor",
        name: pluginName,
        entityId: instance.entityId,
      },
      null,
      instance._scope,
    );
    _actorScopes.set(instance, actorScope);

    // 5. Run the factory with this actor's engine current, even when another
    //    engine is already current. Restore that engine afterwards.
    let api: PublicAPI | undefined;
    const previousEngine = pushEngine(engine);
    try {
      _actorCtx.run({ entityId: instance.entityId, instance, engine }, () => {
        actorScope.run(() => {
          api = (factory as (props?: Props) => PublicAPI)(props);
        });
      });
    } finally {
      popEngine(engine, previousEngine);
    }

    instance.api = api;

    // 6. Register instance on this engine only.
    bucketFor(engine).set(entityId, instance);

    // Per-engine lookup tables for useChildren() cascade.
    // A freshly spawned entity is never owned or pooled on this engine.
    const tables = actorTablesFor(engine);
    tables.owners.delete(entityId);
    tables.poolRelease.delete(entityId);
    tables.actors.set(entityId, _plugin as ActorPlugin<unknown>);
    tables.instances.set(entityId, instance as ActorInstance<unknown>);

    // 7. Fire _start callbacks immediately after setup.
    for (let i = 0; i < instance._start.length; i++) {
      instance._start[i]!();
    }
    instance._start = [];

    return entityId;
  }

  // ─── despawn ─────────────────────────────────────────────────────────────

  function despawn(entityId: EntityId): void {
    const engine = engineOwning(entityId);
    const instance = engine ? _buckets.get(engine)?.get(entityId) : undefined;
    if (!instance || !engine) return;

    // ── Children cascade ────────────────────────────────────────────────────
    // Cascade despawn to all owned children before removing from registries.
    // Always full despawn (not pool release) because the parent is being destroyed.
    if (instance._children && engine) {
      const childIds = [...instance._children];
      instance._children.clear(); // relinquish ownership before children despawn
      for (const childId of childIds) {
        actorTablesFor(engine).actors.get(childId)?.despawn(childId);
      }
    }

    // 1. Remove from registries FIRST (re-entrancy guard).
    _buckets.get(engine)?.delete(entityId);

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
    engine.destroyEntity(entityId);

    // ── Registry cleanup ────────────────────────────────────────────────────
    // Resolve parent link before deleting own entries (ownerId !== entityId — no conflict).
    const tables = engine ? actorTablesFor(engine) : undefined;
    const ownerId = tables?.owners.get(entityId);
    tables?.actors.delete(entityId);
    tables?.instances.delete(entityId);
    tables?.poolRelease.delete(entityId);

    if (ownerId !== undefined && tables) {
      tables.owners.delete(entityId);
      const ownerInstance = tables.instances.get(ownerId);
      ownerInstance?._children?.delete(entityId);
    }
  }

  // ─── Plugin ───────────────────────────────────────────────────────────────

  const _plugin: ActorPlugin<Props> = {
    name: pluginName,

    setup(engine: GwenEngineBase): void {
      const real = useEngine();
      if (_engines.has(real)) {
        _log = engine.logger.child(`actor:${pluginName}`);
        return;
      }
      _engines.add(real);
      real.disposables.add(
        "actor-engine",
        createDisposable(() => {
          _engines.delete(real);
          _buckets.delete(real);
        }),
      );
      _log = engine.logger.child(`actor:${pluginName}`);
    },

    spawn,
    despawn,
  };

  // The Vite transform may later overwrite this with the injected array.
  // Explicit options take precedence during the current module evaluation.
  if (options?.deps !== undefined) {
    _plugin._deps = options.deps.map((d) => d._plugin);
  }

  return {
    _plugin,
    _instances,
    _prefab: prefab,
    __actorName__: pluginName,
  };
}

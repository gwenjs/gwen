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
 * - Lifecycle composables (`onStart`, `onDestroy`, `onEvent`) read from the
 *   module-level actor context set during `spawn`.
 * - Frame-phase composables (`onUpdate`, `onBeforeUpdate`, `onAfterUpdate`,
 *   `onRender`) work via `_withSystemContext` from `system.ts`.
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

import type { GwenEngine } from "../../engine/gwen-engine";
import type { GwenRuntimeHooks } from "../../engine/runtime-hooks";
import type { EntityId } from "../../engine/engine-api";
import { _withSystemContext } from "../../system/defines/define-system";
import type { SystemContext } from "../../system/defines/define-system";
import { withCleanup } from "../../cleanup-context";
import { GwenActorError, ActorErrorCodes } from "../../engine/engine-errors";
import type { GwenLogger } from "../../logger/types";
import type {
  ActorDefinition,
  ActorInstance,
  ActorPlugin,
  PrefabDefinition,
  VoidFn,
  UpdateFn,
  RenderFn,
} from "../types";

// ─── Module-level actor context ───────────────────────────────────────────────

/**
 * The entity ID of the actor currently being spawned.
 * Set by `_withActorContext`, cleared afterwards.
 * @internal
 */
let _currentActorEntityId: bigint | null = null;

/**
 * The `ActorInstance` currently being built during `spawn()`.
 * Set by `_withActorContext`, cleared afterwards.
 * @internal
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _currentActorInstance: ActorInstance<any> | null = null;

/**
 * The `GwenEngine` belonging to the actor currently being spawned.
 * Set by `_withActorContext`, cleared afterwards.
 * @internal
 */
let _currentEngine: GwenEngine | null = null;

// ─── Actor context helpers ────────────────────────────────────────────────────

/**
 * Run `fn` with an actor context slot active, restoring the previous context
 * on completion (supports nested / re-entrant spawns).
 *
 * @param instance - The `ActorInstance` being built.
 * @param engine - The engine the actor belongs to.
 * @param fn - The factory callback to execute inside this context.
 * @internal
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function _withActorContext(instance: ActorInstance<any>, engine: GwenEngine, fn: () => void): void {
  const prevId = _currentActorEntityId;
  const prevInst = _currentActorInstance;
  const prevEngine = _currentEngine;

  _currentActorEntityId = instance.entityId;
  _currentActorInstance = instance;
  _currentEngine = engine;

  try {
    fn();
  } finally {
    _currentActorEntityId = prevId;
    _currentActorInstance = prevInst;
    _currentEngine = prevEngine;
  }
}

/**
 * Returns the entity ID of the actor currently being spawned.
 *
 * Used by `useComponent()` to know which entity to target.
 *
 * @returns The active actor's entity ID as a `bigint`.
 * @throws {Error} If called outside an active actor spawn context.
 *
 * @example
 * ```typescript
 * // Inside a composable called from an actor factory:
 * const entityId = _getActorEntityId()
 * ```
 *
 * @internal
 */
export function _getActorEntityId(): bigint {
  if (_currentActorEntityId === null) {
    throw new Error(
      "[GWEN] _getActorEntityId() must be called inside a defineActor() factory function. " +
        "It is only valid during actor spawn.",
    );
  }
  return _currentActorEntityId;
}

/**
 * Returns the ECS entity ID of the actor currently being set up.
 *
 * Call this inside a `defineActor()` factory (or inside a composable called
 * from one) to obtain the `bigint` identifier that uniquely names this actor
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
 * @returns The `bigint` entity ID for the actor being set up.
 * @throws {Error} If called outside an active `defineActor()` factory context.
 */
export function useEntityId(): bigint {
  if (_currentActorEntityId === null) {
    throw new Error(
      "[GWEN] useEntityId() must be called inside a defineActor() factory function. " +
        "It is only valid during actor spawn.",
    );
  }
  return _currentActorEntityId;
}

/**
 * Returns the engine that owns the actor currently being spawned.
 *
 * Used by `useComponent()` to capture the engine reference at factory call time,
 * so that component reads/writes can be performed without requiring an active
 * engine context inside frame callbacks.
 *
 * @returns The active actor's owning {@link GwenEngine}.
 * @throws {Error} If called outside an active actor spawn context.
 *
 * @example
 * ```typescript
 * // Inside a composable called from an actor factory:
 * const engine = _getActorEngine()
 * ```
 *
 * @internal
 */
export function _getActorEngine(): GwenEngine {
  if (_currentEngine === null) {
    throw new Error(
      "[GWEN] _getActorEngine() must be called inside a defineActor() factory function. " +
        "It is only valid during actor spawn.",
    );
  }
  return _currentEngine;
}

/**
 * Returns the {@link ActorInstance} currently being spawned, or `null` if
 * called outside any active actor spawn context.
 *
 * Used internally by {@link useHook} to detect whether a hook subscription is
 * being registered from inside an actor factory, so that a dormancy guard can
 * be attached at fire time.
 *
 * Do **not** call this from user-land code — use {@link useEntityId} instead.
 *
 * @internal
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function _tryGetActorInstance(): ActorInstance<any> | null {
  return _currentActorInstance;
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
  if (!_currentActorInstance) {
    throw new Error(
      "[GWEN] onStart() must be called synchronously inside a defineActor() factory function.",
    );
  }
  _currentActorInstance._start.push(fn);
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
  if (!_currentActorInstance) {
    throw new Error(
      "[GWEN] onDestroy() must be called synchronously inside a defineActor() factory function.",
    );
  }
  _currentActorInstance._destroy.push(fn);
}

/**
 * Registers a handler on a named engine hook and schedules its removal when
 * the actor is despawned.
 *
 * Must be called synchronously inside a {@link defineActor} factory function.
 *
 * @param name - The hook name (must be a key of {@link GwenRuntimeHooks} or a
 *   declaration-merged extension).
 * @param fn - The handler to register.
 * @throws {Error} If called outside an active actor factory.
 *
 * @example
 * ```typescript
 * defineActor(MyPrefab, () => {
 *   onEvent('entity:spawn', (id) => console.log('entity spawned', id))
 * })
 * ```
 */
/**
 * Creates a dormancy-aware wrapper for an engine hook handler.
 *
 * The wrapper skips dispatch when `instance._isDormant` is `true` (i.e. the
 * actor is currently held in a pool). The generic parameter `F` preserves the
 * original handler's call signature so TypeScript can still verify argument
 * types at the call site — unlike a plain `(...args: unknown[]) => unknown`
 * cast that would silently accept any signature mismatch.
 *
 * @param instance - The {@link ActorInstance} whose dormancy flag is checked.
 * @param fn       - The original typed handler to wrap.
 * @returns A new function with the same signature as `fn`.
 *
 * @internal
 */
export function _createDormancyGuard<F extends (...args: never[]) => unknown>(
  instance: ActorInstance<unknown>,
  fn: F,
): F {
  return ((...args: Parameters<F>) => {
    if (instance._isDormant) return;
    return fn(...(args as Parameters<F>));
  }) as F;
}

export function onEvent<K extends keyof GwenRuntimeHooks>(name: K, fn: GwenRuntimeHooks[K]): void {
  if (!_currentActorInstance || !_currentEngine) {
    throw new Error(
      "[GWEN] onEvent() must be called synchronously inside a defineActor() factory function.",
    );
  }
  const engine = _currentEngine;
  const instance = _currentActorInstance;
  // Wrap the handler via a typed guard so the original signature is preserved.
  const guardedFn = _createDormancyGuard(
    instance,
    fn as (...args: never[]) => unknown,
  ) as GwenRuntimeHooks[K];
  engine.hooks.hook(name, guardedFn as never);
  instance._eventCleanups.push(() => {
    engine.hooks.removeHook(name, guardedFn as never);
  });
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
  if (!_currentActorInstance) {
    throw new Error(
      "[GWEN] onRelease() must be called synchronously inside a defineActor() factory function.",
    );
  }
  _currentActorInstance._release.push(fn);
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
  if (!_currentActorInstance) {
    throw new Error(
      "[GWEN] onReset() must be called synchronously inside a defineActor() factory function.",
    );
  }
  _currentActorInstance._reset.push(fn as (props: unknown) => void);
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
  const _instances = new Map<bigint, ActorInstance<PublicAPI>>();

  /**
   * Flat array mirror of `_instances` values, kept in sync with the Map.
   * Iterating a plain indexed array avoids the `MapIterator` allocation that
   * `_instances.values()` would create on every frame-phase dispatch.
   */
  const _instanceArray: ActorInstance<PublicAPI>[] = [];

  /** The scoped-proxy engine captured during `setup()`. */
  let _engine: GwenEngine | null = null;
  /** Logger scoped to this actor — set in `setup()`, used for cleanup error reporting. */
  let _log: GwenLogger | null = null;

  // ─── spawn ───────────────────────────────────────────────────────────────

  function spawn(props?: Props): bigint {
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
      _start: [],
      _beforeUpdate: [],
      _update: [],
      _afterUpdate: [],
      _render: [],
      _destroy: [],
      _eventCleanups: [],
      _cleanupDispose: undefined,
      _isDormant: false,
      _release: [],
      _reset: [],
      api: undefined as unknown as PublicAPI,
    };

    // 4. Build a SystemContext that pushes into the instance's per-phase arrays.
    const ctx: SystemContext = {
      onBeforeUpdate: (fn: UpdateFn) => instance._beforeUpdate.push(fn),
      onUpdate: (fn: UpdateFn) => instance._update.push(fn),
      onAfterUpdate: (fn: UpdateFn) => instance._afterUpdate.push(fn),
      onRender: (fn: RenderFn) => instance._render.push(fn),
    };

    // 5. Run the factory inside the actor context (for onStart/onDestroy/onEvent)
    //    AND the system context (for onUpdate/onBeforeUpdate/onAfterUpdate/onRender).
    //    Wrapped in withCleanup so any onCleanup() calls are collected and fired on despawn.
    let api: PublicAPI | undefined;
    const [, cleanupDispose] = withCleanup(() => {
      _withActorContext(instance, _engine!, () => {
        _withSystemContext(ctx, () => {
          api = (factory as (props?: Props) => PublicAPI)(props);
        });
      });
    });
    instance._cleanupDispose = cleanupDispose;

    instance.api = api as PublicAPI;

    // 6. Register the instance in both the Map (for O(1) keyed lookup) and the
    //    flat array (for zero-allocation frame-phase iteration).
    _instances.set(entityId, instance);
    _instanceArray.push(instance);

    // 7. Fire _start callbacks immediately after setup, then release the
    //    array so onStart closures (which often capture composable handles
    //    like TransformHandle) are not retained for the actor's lifetime.
    for (let i = 0; i < instance._start.length; i++) {
      instance._start[i]!();
    }
    instance._start = [];

    return entityId;
  }

  // ─── despawn ─────────────────────────────────────────────────────────────

  function despawn(entityId: bigint): void {
    const instance = _instances.get(entityId);
    if (!instance) return;

    // 1. Remove from both registries FIRST.
    //
    //    Doing this before the callbacks serves two purposes:
    //    a) Re-entrancy guard — a re-entrant `despawn(entityId)` call from inside
    //       an `onDestroy` callback finds no instance and returns immediately,
    //       preventing double-cleanup and infinite recursion.
    //    b) Zombie prevention — if any callback throws, the instance is already
    //       gone from the registries so it will never be iterated again or
    //       returned by `_instances.get()`.
    _instances.delete(entityId);
    const arrIdx = _instanceArray.indexOf(instance);
    if (arrIdx !== -1) _instanceArray.splice(arrIdx, 1);

    // 2. Call onDestroy callbacks.
    //    Each callback is isolated: a throw logs the error but does not prevent
    //    the remaining callbacks, event cleanups, or WASM entity destruction from
    //    running.
    for (let i = 0; i < instance._destroy.length; i++) {
      try {
        instance._destroy[i]!();
      } catch (e) {
        _log?.error("onDestroy threw during despawn", { error: String(e) });
      }
    }

    // 3. Unregister onEvent handlers.
    for (let i = 0; i < instance._eventCleanups.length; i++) {
      try {
        instance._eventCleanups[i]!();
      } catch (e) {
        _log?.error("onEvent cleanup threw during despawn", { error: String(e) });
      }
    }

    // 4. Fire onCleanup() callbacks (registered via withCleanup during factory).
    try {
      instance._cleanupDispose?.();
    } catch (e) {
      _log?.error("onCleanup threw during despawn", { error: String(e) });
    }

    // 5. Destroy the ECS entity — always runs, even if TS-side callbacks threw.
    _engine?.destroyEntity(entityId as unknown as EntityId);
  }

  // ─── Plugin ───────────────────────────────────────────────────────────────

  const _plugin: ActorPlugin<Props> = {
    name: pluginName,

    // Populate _deps from the explicit `options.deps` when provided.
    // The Vite transform may later overwrite this with the injected array;
    // explicit options take precedence during the current module evaluation.
    _deps: options?.deps?.map((d) => d._plugin),

    setup(engine: GwenEngine): void {
      _engine = engine;
      _log = engine.logger.child(`actor:${pluginName}`);
    },

    // Frame phase dispatchers — iterate all live instances each frame.

    onBeforeUpdate(dt: number): void {
      for (let j = 0; j < _instanceArray.length; j++) {
        const inst = _instanceArray[j]!;
        if (inst._isDormant) continue;
        for (let i = 0; i < inst._beforeUpdate.length; i++) {
          inst._beforeUpdate[i]!(dt);
        }
      }
    },

    onUpdate(dt: number): void {
      for (let j = 0; j < _instanceArray.length; j++) {
        const inst = _instanceArray[j]!;
        if (inst._isDormant) continue;
        for (let i = 0; i < inst._update.length; i++) {
          inst._update[i]!(dt);
        }
      }
    },

    onAfterUpdate(dt: number): void {
      for (let j = 0; j < _instanceArray.length; j++) {
        const inst = _instanceArray[j]!;
        if (inst._isDormant) continue;
        for (let i = 0; i < inst._afterUpdate.length; i++) {
          inst._afterUpdate[i]!(dt);
        }
      }
    },

    onRender(): void {
      for (let j = 0; j < _instanceArray.length; j++) {
        const inst = _instanceArray[j]!;
        if (inst._isDormant) continue;
        for (let i = 0; i < inst._render.length; i++) {
          inst._render[i]!();
        }
      }
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

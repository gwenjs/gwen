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
export function onEvent<K extends keyof GwenRuntimeHooks>(name: K, fn: GwenRuntimeHooks[K]): void {
  if (!_currentActorInstance || !_currentEngine) {
    throw new Error(
      "[GWEN] onEvent() must be called synchronously inside a defineActor() factory function.",
    );
  }
  const engine = _currentEngine;
  const instance = _currentActorInstance;
  // Register the hook on the engine's hookable (uses scoped hooks proxy captured from setup).
  engine.hooks.hook(name, fn as never);
  // Schedule removal on despawn so the handler does not outlive the actor.
  instance._eventCleanups.push(() => {
    engine.hooks.removeHook(name, fn as never);
  });
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
 */
export function defineActor<Props = void, PublicAPI = void>(
  name: string,
  prefab: PrefabDefinition,
  factory: ActorFactory<Props, PublicAPI>,
): ActorDefinition<Props, PublicAPI>;
/**
 * @overload
 * Anonymous form — the Vite plugin injects the exported variable name automatically.
 * Without the Vite plugin, a stable counter-based name is generated (`actor-1`, `actor-2`, …).
 * @param prefab  - Prefab defining the ECS component layout for this actor.
 * @param factory - Per-instance setup function.
 */
export function defineActor<Props = void, PublicAPI = void>(
  prefab: PrefabDefinition,
  factory: ActorFactory<Props, PublicAPI>,
): ActorDefinition<Props, PublicAPI>;
export function defineActor<Props = void, PublicAPI = void>(
  nameOrPrefab: string | PrefabDefinition,
  prefabOrFactory: PrefabDefinition | ActorFactory<Props, PublicAPI>,
  maybeFactory?: ActorFactory<Props, PublicAPI>,
): ActorDefinition<Props, PublicAPI> {
  const pluginName =
    typeof nameOrPrefab === "string" ? nameOrPrefab : `actor-${++_actorPluginCounter}`;
  const prefab =
    typeof nameOrPrefab === "string"
      ? (prefabOrFactory as PrefabDefinition)
      : (nameOrPrefab as PrefabDefinition);
  const factory = maybeFactory ?? (prefabOrFactory as ActorFactory<Props, PublicAPI>);
  const _instances = new Map<bigint, ActorInstance<PublicAPI>>();

  /**
   * Flat array mirror of `_instances` values, kept in sync with the Map.
   * Iterating a plain indexed array avoids the `MapIterator` allocation that
   * `_instances.values()` would create on every frame-phase dispatch.
   */
  const _instanceArray: ActorInstance<PublicAPI>[] = [];

  /** The scoped-proxy engine captured during `setup()`. */
  let _engine: GwenEngine | null = null;

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

    // 1. Call destroy callbacks.
    for (let i = 0; i < instance._destroy.length; i++) {
      instance._destroy[i]!();
    }

    // 2. Run event cleanups (unregister onEvent handlers).
    for (let i = 0; i < instance._eventCleanups.length; i++) {
      instance._eventCleanups[i]!();
    }

    // 3. Fire onCleanup() callbacks registered during factory (via withCleanup).
    instance._cleanupDispose?.();

    // 4. Destroy the ECS entity.
    _engine?.destroyEntity(entityId as unknown as EntityId);

    // 4. Remove from both registries.
    _instances.delete(entityId);
    const arrIdx = _instanceArray.indexOf(instance);
    if (arrIdx !== -1) _instanceArray.splice(arrIdx, 1);
  }

  // ─── Plugin ───────────────────────────────────────────────────────────────

  const _plugin: ActorPlugin<Props> = {
    name: pluginName,

    setup(engine: GwenEngine): void {
      _engine = engine;
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

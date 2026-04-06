/**
 * @file RFC-011 — `defineActor()` for @gwenjs/core
 *
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

import type { GwenEngine } from '../engine/gwen-engine.js';
import type { GwenRuntimeHooks } from '../engine/runtime-hooks.js';
import type { EntityId } from '../engine/engine-api.js';
import { _withSystemContext } from '../system.js';
import type { SystemContext } from '../system.js';
import type {
  ActorDefinition,
  ActorInstance,
  ActorPlugin,
  PrefabDefinition,
  VoidFn,
  UpdateFn,
  RenderFn,
} from './types.js';

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
 * Used by `useComponent()` (RFC-011 Task 7) to know which entity to target.
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
      '[GWEN] _getActorEntityId() must be called inside a defineActor() factory function. ' +
        'It is only valid during actor spawn.',
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
      '[GWEN] _getActorEngine() must be called inside a defineActor() factory function. ' +
        'It is only valid during actor spawn.',
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
      '[GWEN] onStart() must be called synchronously inside a defineActor() factory function.',
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
      '[GWEN] onDestroy() must be called synchronously inside a defineActor() factory function.',
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
      '[GWEN] onEvent() must be called synchronously inside a defineActor() factory function.',
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

/**
 * Factory type accepted by {@link defineActor}.
 *
 * @template Props - Props forwarded from `spawn(props?)`.
 * @template PublicAPI - The object returned by the factory (actor's public API).
 */
type ActorFactory<Props, PublicAPI> = (props?: Props) => PublicAPI;

/**
 * Defines an actor type: a composable, instance-based game object backed by a
 * single ECS entity per instance.
 *
 * Returns an {@link ActorDefinition} containing:
 * - `_plugin` — a `GwenPlugin` (with `spawn`/`despawn` extensions) to pass to
 *   `engine.use()`.
 * - `_instances` — a live `Map<bigint, ActorInstance>` registry.
 * - `_prefab` — the prefab that declares the actor's ECS component layout.
 *
 * The `factory` runs **per instance** inside `spawn()`. During the factory call,
 * both the actor context (for `onStart`, `onDestroy`, `onEvent`) and the system
 * context (for `onUpdate`, `onBeforeUpdate`, `onAfterUpdate`, `onRender`) are
 * active so all lifecycle composables resolve correctly.
 *
 * @param prefab - The prefab defining the ECS component layout for this actor.
 * @param factory - Per-instance setup function. May register lifecycle callbacks
 *   and return a public API object.
 * @returns An {@link ActorDefinition} ready to be used with `engine.use()`.
 *
 * @example
 * ```typescript
 * const Position = defineComponent('Position', { x: 0, y: 0 })
 * const EnemyPrefab = definePrefab([{ def: Position, defaults: { x: 0, y: 0 } }])
 *
 * export const EnemyActor = defineActor(EnemyPrefab, (props?: { hp: number }) => {
 *   onStart(() => console.log('enemy spawned'))
 *   onDestroy(() => console.log('enemy destroyed'))
 *   onUpdate((dt) => { ... })
 *   return { takeDamage: (amount: number) => { ... } }
 * })
 *
 * await engine.use(EnemyActor._plugin)
 * const id = EnemyActor._plugin.spawn({ hp: 100 })
 * EnemyActor._plugin.despawn(id)
 * ```
 */
export function defineActor<Props = void, PublicAPI = void>(
  prefab: PrefabDefinition,
  factory: ActorFactory<Props, PublicAPI>,
): ActorDefinition<Props, PublicAPI> {
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
      throw new Error(
        '[GWEN] Actor.spawn() called before the plugin was set up. ' +
          'Call `await engine.use(actor._plugin)` before spawning.',
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
      // api is filled after the factory runs.
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
    let api: PublicAPI | undefined;
    _withActorContext(instance, _engine, () => {
      _withSystemContext(ctx, () => {
        api = factory(props);
      });
    });

    instance.api = api as PublicAPI;

    // 6. Register the instance in both the Map (for O(1) keyed lookup) and the
    //    flat array (for zero-allocation frame-phase iteration).
    _instances.set(entityId, instance);
    _instanceArray.push(instance);

    // 7. Fire _start callbacks immediately after setup.
    for (let i = 0; i < instance._start.length; i++) {
      instance._start[i]!();
    }

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

    // 3. Destroy the ECS entity.
    _engine?.destroyEntity(entityId as unknown as EntityId);

    // 4. Remove from both registries.
    _instances.delete(entityId);
    const arrIdx = _instanceArray.indexOf(instance);
    if (arrIdx !== -1) _instanceArray.splice(arrIdx, 1);
  }

  // ─── Plugin ───────────────────────────────────────────────────────────────

  const _plugin: ActorPlugin<Props> = {
    name: 'anonymous-actor',

    setup(engine: GwenEngine): void {
      _engine = engine;
    },

    // Frame phase dispatchers — iterate all live instances each frame.

    onBeforeUpdate(dt: number): void {
      for (let j = 0; j < _instanceArray.length; j++) {
        const inst = _instanceArray[j]!;
        for (let i = 0; i < inst._beforeUpdate.length; i++) {
          inst._beforeUpdate[i]!(dt);
        }
      }
    },

    onUpdate(dt: number): void {
      for (let j = 0; j < _instanceArray.length; j++) {
        const inst = _instanceArray[j]!;
        for (let i = 0; i < inst._update.length; i++) {
          inst._update[i]!(dt);
        }
      }
    },

    onAfterUpdate(dt: number): void {
      for (let j = 0; j < _instanceArray.length; j++) {
        const inst = _instanceArray[j]!;
        for (let i = 0; i < inst._afterUpdate.length; i++) {
          inst._afterUpdate[i]!(dt);
        }
      }
    },

    onRender(): void {
      for (let j = 0; j < _instanceArray.length; j++) {
        const inst = _instanceArray[j]!;
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
    __actorName__: 'anonymous',
    // Type markers — values are never accessed at runtime.
    __props__: undefined as unknown as Props,
    __api__: undefined as unknown as PublicAPI,
  };
}

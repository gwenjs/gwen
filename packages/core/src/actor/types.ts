/**
 * @file Scene type definitions for the RFC-011 actor system.
 *
 * Exports shared callback types (`UpdateFn`, `RenderFn`, `VoidFn`) and the
 * core data structures (`ActorInstance`, `ActorPlugin`, `ActorDefinition`)
 * used by `defineActor`, `useActor`, and related composables.
 */

// packages/core/src/scene/types.ts
import type { GwenPlugin } from "../engine/gwen-engine";

// Prefab types live in core — re-exported here for convenience
export type { PrefabComponentEntry, PrefabDefinition } from "./defines/define-prefab";
import type { PrefabDefinition } from "./defines/define-prefab";

// ─── Actor ────────────────────────────────────────────────────────────────────

/**
 * Frame-update callback invoked every simulation tick with the elapsed time.
 *
 * Registered via `onUpdate()`, `onBeforeUpdate()`, or `onAfterUpdate()` inside
 * a `defineActor()` factory. Each live actor instance receives a separate call
 * every frame.
 *
 * @param dt - Elapsed time since the last frame, in **seconds**.
 */
export type UpdateFn = (dt: number) => void;

/**
 * Render-phase callback invoked once per render frame.
 *
 * Registered via `onRender()` inside a `defineActor()` factory. No delta-time
 * is provided — use this for draw calls and visual state synchronisation only.
 */
export type RenderFn = () => void;

/**
 * General-purpose no-argument, no-return callback.
 *
 * Used for actor lifecycle hooks that require no parameters, such as `onStart`
 * (called once immediately after spawn) and `onDestroy` (called once before
 * the actor's entity is removed from the ECS).
 */
export type VoidFn = () => void;

/**
 * Internal per-instance state tracked by the actor plugin for one spawned entity.
 *
 * Created during `spawn()` and populated by the actor factory via lifecycle
 * composables (`onStart`, `onUpdate`, `onDestroy`, etc.). The plugin iterates
 * these arrays every frame to dispatch callbacks in phase order.
 *
 * @template PublicAPI - The object returned by the actor factory and stored as `api`.
 * @internal
 */
export interface ActorInstance<PublicAPI = void> {
  /** ECS entity ID assigned to this instance at spawn time. */
  entityId: bigint;
  /** Callbacks registered via `onStart()` — fired once immediately after spawn. */
  _start: VoidFn[];
  /** Callbacks registered via `onBeforeUpdate()` — fired each frame before the main update. */
  _beforeUpdate: UpdateFn[];
  /** Callbacks registered via `onUpdate()` — fired each frame during the main update phase. */
  _update: UpdateFn[];
  /** Callbacks registered via `onAfterUpdate()` — fired each frame after the main update. */
  _afterUpdate: UpdateFn[];
  /** Callbacks registered via `onRender()` — fired each render frame. */
  _render: RenderFn[];
  /** Callbacks registered via `onDestroy()` — fired once immediately before despawn. */
  _destroy: VoidFn[];
  /** Cleanup fns for onEvent() — called on despawn to unregister engine hook handlers. */
  _eventCleanups: VoidFn[];
  /** Dispose function from withCleanup() — fires all onCleanup() callbacks registered during factory. */
  _cleanupDispose?: () => void;
  /**
   * When `true`, this instance is dormant inside a pool.
   * Frame dispatchers skip it; event handlers silently ignore it.
   * Set by `defineActorPool` — do not mutate directly.
   * @internal
   */
  _isDormant: boolean;
  /**
   * Callbacks registered via `onRelease()`.
   * Called when the actor is returned to a pool. Not called by `despawn()`.
   * @internal
   */
  _release: VoidFn[];
  /**
   * Callbacks registered via `onReset()`.
   * Called with the new props when the actor is reacquired from a pool.
   * @internal
   */
  _reset: ((props: unknown) => void)[];
  /** Public API returned by the factory and exposed via `ActorHandle.get()` / `getAll()`. */
  api: PublicAPI;
}

/**
 * Actor plugin that extends {@link GwenPlugin} with `spawn` and `despawn` methods.
 *
 * These methods are not part of the standard `GwenPlugin` interface; they are
 * exposed here for internal use by `defineActor` and `useActor`.
 *
 * @template Props - The props type accepted by `spawn`.
 */
export interface ActorPlugin<Props = void> extends GwenPlugin {
  /**
   * Spawn a new actor instance.
   *
   * When `Props` is `void` no argument is needed.
   * When `Props` is a concrete type the props argument is required.
   *
   * @returns The ECS entity ID of the spawned instance.
   */
  spawn(...args: Props extends void ? [] : [props: Props]): bigint;

  /**
   * Despawn the actor instance associated with the given entity ID.
   * Calls all `_destroy` callbacks and event cleanups before destroying the entity.
   *
   * @param entityId - The entity ID returned by `spawn`.
   */
  despawn(entityId: bigint): void;

  /**
   * Optional array of actor plugins that this actor's factory depends on via
   * `useActor()`. Populated at build time by the `@gwenjs/vite` transform so
   * that `useActor()` in a scene factory can transitively register all required
   * plugins before the scene bootstraps.
   *
   * Not set in test environments (no Vite transform). Do not rely on this field
   * being present at runtime — always check for `undefined` before iterating.
   *
   * @internal Set by the Vite actor transform; do not mutate manually.
   */
  _deps?: GwenPlugin[];
}

/**
 * Definition of an actor produced by `defineActor()`.
 */
export interface ActorDefinition<Props = void, PublicAPI = void> {
  /** Internal ECS plugin — pass to `engine.use()`. */
  readonly _plugin: ActorPlugin<Props>;
  /** Live instance registry (entityId → instance). */
  readonly _instances: Map<bigint, ActorInstance<PublicAPI>>;
  /** Prefab declaring memory layout. */
  readonly _prefab: PrefabDefinition;
  /** Debug name (injected by Vite transform, else 'anonymous'). @internal */
  readonly __actorName__: string;
  /** @internal Type marker for Props inference. */
  readonly __props__: Props;
  /** @internal Type marker for PublicAPI inference. */
  readonly __api__: PublicAPI;
}

// ─── Layout types ─────────────────────────────────────────────────────────────

/**
 * A handle to a single entity spawned by `placeActor`, `placeGroup`, or `placePrefab`.
 *
 * @template API - The public API object returned by the actor factory. `void` for groups/prefabs.
 */
export interface PlaceHandle<API = void> {
  /** ECS entity ID assigned at spawn time. */
  readonly entityId: bigint;
  /**
   * Public API returned by the actor factory.
   * `void` for groups and prefabs.
   */
  readonly api: API;
  /**
   * Update the entity's local position (triggers TransformDirty → Rust propagation).
   * @param pos - `[x, y]` or `[x, y, z]` local coordinates.
   */
  moveTo(pos: [number, number] | [number, number, number]): void;
  /** Despawn this entity without affecting other entities in the layout. */
  despawn(): void;
}

/**
 * Opaque definition produced by `defineLayout()`. Pass to `useLayout()`.
 *
 * @template Refs - The object type returned by the layout factory.
 */
export interface LayoutDefinition<Refs extends Record<string, PlaceHandle<unknown>>> {
  /** @internal */
  _factory: () => Refs;
  /** @internal Display name used by devtools and HMR. */
  __layoutName__: string;
}

/**
 * Options for `useLayout()`.
 */
export interface UseLayoutOptions {
  /**
   * When `true`, entities are not spawned until `load()` is explicitly called.
   * @default false
   */
  lazy?: boolean;
  /**
   * Maximum number of entities to spawn per frame when loading.
   * Prevents frame drops for layouts with >100 entities.
   *
   * @todo Progressive chunked spawn is not yet implemented.
   *       Passing this option emits a console.warn and loads all entities at once.
   */
  chunkSize?: number;
}

/**
 * Live handle returned by `useLayout()`.
 *
 * @template Refs - The typed refs returned by the layout factory.
 */
export interface LayoutHandle<Refs> {
  /**
   * The handles returned by the layout factory, typed automatically.
   * Only available after `load()` resolves.
   */
  readonly refs: Refs;
  /** `true` if the layout is currently loaded (entities are alive). */
  readonly active: boolean;
  /**
   * Spawn all entities declared in the layout factory.
   * Resolves when all entities are alive.
   */
  load(): Promise<void>;
  /**
   * Despawn all entities owned by this layout via a single `bulk_destroy` WASM call.
   * Idempotent — safe to call on an inactive layout.
   */
  dispose(): Promise<void>;
}

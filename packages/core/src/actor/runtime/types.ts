/**
 * @file Scene type definitions for the RFC-011 actor system.
 *
 * Exports shared callback types (`UpdateFn`, `RenderFn`, `VoidFn`) and the
 * core data structures (`ActorInstance`, `ActorPlugin`, `ActorDefinition`)
 * used by `defineActor`, `useActor`, and related composables.
 */

// packages/core/src/scene/types.ts
import type { GwenPlugin } from "../../engine/gwen-engine";
import type { PrefabDefinition } from "./define-prefab";
import type { EntityId } from "../../engine/engine-api";
import type { ScopedHookable } from "../../hooks/scoped-hookable";
import type { ComponentDef } from "../../system/runtime/define-system";

// Prefab types live in core — re-exported here for convenience
export type { PrefabDefinition, PrefabEntries, PrefabOverrides } from "./define-prefab";
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
export interface ActorInstance<PublicAPI> {
  /** ECS entity ID assigned to this instance at spawn time. */
  entityId: EntityId;
  /** Callbacks registered via `onStart()` — fired once immediately after spawn. */
  _start: VoidFn[];
  /**
   * The `ScopedHookable` that owns all frame-phase subscriptions for this instance.
   * Paused by the pool on release; resumed on acquire; disposed on despawn.
   * @internal
   */
  _scope: ScopedHookable;
  /** Callbacks registered via `onDestroy()` — fired once immediately before despawn. */
  _destroy: VoidFn[];
  /**
   * Callbacks registered via `onEnable()` — fired when the actor's scope is resumed
   * (pool re-acquire or explicit enable). Not called on initial spawn.
   * @internal
   */
  _enable: VoidFn[];
  /**
   * Callbacks registered via `onDisable()` — fired when the actor's scope is paused
   * (pool release or explicit disable).
   * @internal
   */
  _disable: VoidFn[];
  /**
   * Callbacks registered via `onRelease()` — fired on pool release. Not called by `despawn()`.
   * @internal
   */
  _release: VoidFn[];
  /**
   * Callbacks registered via `onReset()` — fired on pool re-acquire with new props.
   * @internal
   */
  _reset: ((props: unknown) => void)[];
  /**
   * Entity IDs of owned child actors registered via `useChildren()`.
   * `undefined` when `useChildren()` was never called — zero overhead.
   * @internal
   */
  _children?: Set<EntityId>;
  /**
   * Public API returned by the factory.
   * `undefined` until the factory returns, including while the factory itself runs.
   */
  api: PublicAPI | undefined;
}

/**
 * Actor plugin that extends {@link GwenPlugin} with `spawn` and `despawn` methods.
 *
 * These methods are not part of the standard `GwenPlugin` interface; they are
 * exposed here for internal use by `defineActor` and `useActor`.
 *
 * @template Props - The props type accepted by `spawn`.
 */
export interface ActorPlugin<Props> extends GwenPlugin {
  /**
   * Spawn a new actor instance.
   *
   * When `Props` is `void` no argument is needed.
   * When `Props` is a concrete type the props argument is required.
   *
   * @returns The branded {@link EntityId} of the spawned instance.
   */
  spawn(...args: Props extends void ? [] : [props: Props]): EntityId;

  /**
   * Despawn the actor instance associated with the given entity ID.
   *
   * @param entityId - The {@link EntityId} returned by `spawn`.
   */
  despawn(entityId: EntityId): void;

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
export interface ActorDefinition<Props, PublicAPI> {
  /** Internal ECS plugin — pass to `engine.use()`. */
  readonly _plugin: ActorPlugin<Props>;
  /** Live instance registry (entityId → instance). */
  readonly _instances: Map<EntityId, ActorInstance<PublicAPI>>;
  /** Prefab declaring memory layout. */
  readonly _prefab: PrefabDefinition<readonly ComponentDef[]>;
  /** Debug name (injected by Vite transform, else 'anonymous'). @internal */
  readonly __actorName__: string;
  /** @internal Type-only marker. Not present at runtime. */
  readonly __props__?: Props;
  /** @internal Type-only marker. Not present at runtime. */
  readonly __api__?: PublicAPI;
}

// ─── Layout types ─────────────────────────────────────────────────────────────

/**
 * A handle to a single entity spawned by `placeActor`, `placeGroup`, or `placePrefab`.
 *
 * @template API - The public API object returned by the actor factory. `void` for groups/prefabs.
 */
export interface PlaceHandle<API> {
  /** ECS entity ID assigned at spawn time. */
  readonly entityId: EntityId;
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

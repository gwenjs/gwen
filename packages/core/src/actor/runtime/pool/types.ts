import type { Hookable } from "hookable";
import type { EntityId } from "../../../engine/engine-api";
import type { GwenPlugin } from "../../../engine/gwen-engine";

/**
 * Options accepted by `defineActorPool()`.
 */
export interface PoolOptions {
  /**
   * Maximum number of entity slots in the pool.
   * Once this limit is reached and all slots are active, `acquire()` throws
   * a `PoolExhaustedError`.
   */
  size: number;

  /**
   * Fraction of pool capacity that triggers a `warn` log.
   * @default 0.8
   */
  warnThreshold?: number;

  /**
   * Fraction of pool capacity that triggers an `error` log.
   * @default 0.95
   */
  criticalThreshold?: number;

  /**
   * Pool lifecycle scope.
   *
   * - `'global'` — pool survives scene transitions; `destroyAll()` is called
   *   automatically on `engine:stop`.
   * - `CustomScope` — caller provides mount/unmount hooks.
   *
   * For scene-scoped cleanup, use `useActorPool()` inside a `defineScene` factory.
   *
   * @default undefined — no automatic lifecycle management
   */
  scope?: "global" | CustomScope;
}

/**
 * User-supplied lifecycle hooks for a custom pool scope.
 */
export interface CustomScope {
  /** Called once when the pool plugin is installed via `engine.use(pool._plugin)`. */
  onMount: (pool: ActorPool<unknown, unknown>) => void;
  /** Called when the engine stops or the scope is torn down. */
  onUnmount: (pool: ActorPool<unknown, unknown>) => void;
}

/**
 * Observable events emitted by an `ActorPool`.
 */
export interface PoolHooks {
  /** Fired just before the acquired slot is returned to the caller. */
  "pool:acquire": (payload: { id: EntityId; props: unknown }) => void;
  /** Fired just after a slot is marked dormant by `release()`. */
  "pool:release": (payload: { id: EntityId }) => void;
  /** Fired when active slots exceed `warnThreshold`. */
  "pool:warn": (payload: { active: number; size: number; ratio: number }) => void;
  /** Fired when active slots exceed `criticalThreshold`. */
  "pool:critical": (payload: { active: number; size: number; ratio: number }) => void;
  /** Fired when the pool is exhausted, immediately before the throw. */
  "pool:exhausted": (payload: { size: number }) => void;
}

/**
 * Snapshot of current pool metrics.
 */
export interface PoolStats {
  /** Maximum number of slots in the pool. */
  size: number;
  /** Number of slots currently acquired and active. */
  active: number;
  /** Number of dormant slots ready for reuse. */
  available: number;
  /** Historical peak of simultaneously active slots. */
  peakActive: number;
  /** Total number of `acquire()` calls since pool creation. */
  acquireCount: number;
}

/**
 * Public interface of an actor pool returned by `defineActorPool()`.
 *
 * @template Props - Props type forwarded to `onReset()` on reuse.
 * @template _PublicAPI - Actor public API type (matches `defineActor`). Carried for type inference — not used in the interface body directly.
 */
export interface ActorPool<Props, _PublicAPI> {
  /** Plugin to register with `engine.use()`. Must be installed before calling `acquire()`. */
  readonly _plugin: GwenPlugin;
  /**
   * The underlying actor's plugin. Must be installed before `_plugin`.
   * Used by `useActorPool()` to register both plugins in the correct order
   * during scene setup.
   * @internal
   */
  readonly _actorPlugin: GwenPlugin;
  /** Name of the pooled actor, used in logs and diagnostics. */
  readonly actorName: string;
  /**
   * Acquires a slot from the pool.
   *
   * - Reuses a dormant slot when one is available — zero allocation cost.
   * - Creates a new entity lazily when `size` has not been reached yet.
   * - Throws `PoolExhaustedError` when all slots are active.
   *
   * @param props - Forwarded to `onReset()` and used to override prefab defaults.
   * @throws {PoolExhaustedError} When all slots are active and the pool cannot grow.
   */
  acquire(...args: Props extends void ? [] : [props: Props]): EntityId;
  /**
   * Returns a slot to the pool (deferred to end of frame for mid-frame safety).
   * Calls `onRelease()` callbacks and marks the instance dormant.
   * No-op if the id is unknown or already released.
   */
  release(id: EntityId): void;
  /**
   * Destroys all slots in the pool — both dormant and active.
   * Calls `onDestroy()` on every instance. Does not call `onRelease()`.
   * Safe to call on an empty pool.
   */
  destroyAll(): void;
  /** Returns a snapshot of current pool metrics. */
  stats(): PoolStats;
  /** Subscribe to pool lifecycle events. */
  readonly hooks: Hookable<PoolHooks>;
}

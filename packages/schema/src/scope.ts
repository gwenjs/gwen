/**
 * @file Unified execution scope contract.
 *
 * Every GWEN runtime object (engine, plugin, scene, actor, system) owns a
 * `GwenScope` instance — the unified context replacing `_actorCtx`, `_sceneCtx`,
 * `_activeScopeSlot`, and `_cleanupStack`.
 *
 * @module
 */

import type { GwenRuntimeHooks } from "./plugin.js";

/** Discriminant for the runtime object that owns a scope. */
export type GwenScopeType = "engine" | "plugin" | "scene" | "actor" | "system";

/** Immutable identity metadata attached to every `GwenScope`. */
export interface GwenScopeMeta {
  /** Runtime object category — used for filtering and devtools display. */
  readonly type: GwenScopeType;
  /** Stable unique identifier. Auto-generated as `"type#N"` if not provided. */
  readonly id: string;
  /** Human-readable name (e.g. plugin id, actor class name). */
  readonly name?: string;
  /** ECS entity ID — set for actor and system scopes. */
  readonly entityId?: bigint;
}

/**
 * Public contract for a GWEN execution scope.
 *
 * Plugin authors type their scope references as `IGwenScope` (from `@gwenjs/schema`)
 * rather than `GwenScope` (from `@gwenjs/core`) to avoid a hard dependency on core.
 * Obtain an instance via `useCurrentScope()` from `@gwenjs/kit`.
 */
export interface IGwenScope {
  readonly meta: GwenScopeMeta;
  readonly engine: unknown;
  readonly parent: IGwenScope | null;
  /** `true` when the scope's hooks are silenced (pool dormancy). */
  readonly paused: boolean;
  /** Number of active hook subscriptions in this scope. */
  readonly hookCount: number;
  /** Number of direct child scopes. */
  readonly childCount: number;
  /** Number of pending cleanup callbacks. */
  readonly cleanupCount: number;
  /** Subscribe to a runtime hook. Returns an unsubscribe function. */
  hook<K extends keyof GwenRuntimeHooks>(name: K, fn: GwenRuntimeHooks[K]): () => void;
  /** Register a cleanup callback — executed LIFO when this scope is disposed. */
  onCleanup(fn: () => void): void;
  /** Execute `fn` with this scope as the active scope. Always restores the previous scope. */
  run<T>(fn: () => T): T;
  /** Silence all hook callbacks (e.g. when a pool slot becomes dormant). */
  pause(): void;
  /** Re-enable all hook callbacks. */
  resume(): void;
  /** Dispose this scope and all children, run cleanups LIFO. Idempotent. */
  dispose(): void;
}

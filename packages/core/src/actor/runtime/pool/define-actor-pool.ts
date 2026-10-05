import { createHooks } from "hookable";
import type { EntityId } from "../../../engine/engine-api";
import type { GwenEngine, GwenPlugin } from "../../../engine/gwen-engine";
import type { GwenEngineBase } from "@gwenjs/schema";
import type { ActorDefinition } from "../types";
import { DormantTag } from "./dormant-tag";
import { PoolExhaustedError } from "./errors";
import type { ActorPool, PoolHooks, PoolOptions, PoolStats } from "./types";
import { useHook } from "../../../hooks/use-hook";
import { _actorRegistry, _poolReleaseRegistry } from "../define-actor";

/**
 * Manages the queue of actor pool slots scheduled for deferred release.
 *
 * Slots added via {@link enqueue} are held until {@link flush} is called
 * (typically at `engine:afterTick`). Using a `Set` for the pending queue
 * guarantees O(1) duplicate detection — an important property since
 * `release()` can be called multiple times per frame for the same entity.
 *
 * @internal
 */
class DeferredReleaseQueue {
  private readonly _pending = new Set<EntityId>();

  /**
   * Schedule `id` for release at the end of the current frame.
   * Calling this multiple times with the same `id` in the same frame is safe —
   * the second call is a no-op.
   *
   * @param id - The entity to release.
   * @returns `true` if the id was newly enqueued, `false` if already pending.
   */
  enqueue(id: EntityId): boolean {
    if (this._pending.has(id)) return false;
    this._pending.add(id);
    return true;
  }

  /** Returns `true` if `id` is already waiting for release. */
  has(id: EntityId): boolean {
    return this._pending.has(id);
  }

  /**
   * Drain the queue, calling `releaseFn` for each pending id in insertion order.
   * The queue is cleared atomically before any callback fires — re-entrant
   * `enqueue` calls inside `releaseFn` will be processed on the next flush.
   */
  flush(releaseFn: (id: EntityId) => void): void {
    const snapshot = Array.from(this._pending);
    this._pending.clear();
    for (const id of snapshot) {
      releaseFn(id);
    }
  }

  /** Number of ids currently waiting for release. */
  get size(): number {
    return this._pending.size;
  }
}

/**
 * Creates an actor pool for reusing ECS entities instead of destroying and
 * recreating them on each spawn cycle.
 *
 * Entities are allocated lazily on demand up to `options.size`. Once released,
 * a slot becomes dormant and is reused by the next `acquire()` call at zero
 * allocation cost. Releases are deferred to the end of the current frame to
 * prevent mid-frame mutations from corrupting frame iteration.
 *
 * The pool plugin must be installed before calling `acquire()` or `release()`:
 * ```ts
 * await engine.use(Actor._plugin)      // actor first
 * await engine.use(EnemyPool._plugin)  // then the pool
 * ```
 *
 * @param actor - The actor definition to pool (result of `defineActor()`).
 * @param options - Pool configuration.
 * @returns A pool object with `acquire`, `release`, `destroyAll`, `stats`, and `hooks`.
 * * ### Dormancy behaviour
 *
 * A released actor is marked **dormant** until re-acquired. While dormant:
 *
 * - {@link useHook} handlers are **silently skipped** — the event fires but the
 *   handler is never invoked while the actor is dormant. This is intentional:
 *   dormant actors should not react to game events.
 * - ECS queries exclude dormant entities (a `DormantTag` component is added at
 *   release time and removed at re-acquire time).
 * - `onRelease` callbacks fire immediately when `release()` is flushed.
 * - `onReset` callbacks fire when the slot is re-acquired with `acquire()`.
 */
export function defineActorPool<Props, PublicAPI>(
  actor: ActorDefinition<Props, PublicAPI>,
  options: PoolOptions,
): ActorPool<Props, PublicAPI> {
  const { size, warnThreshold = 0.8, criticalThreshold = 0.95 } = options;
  const actorName = actor.__actorName__;

  // The engine reference is set in setup() and is guaranteed to be non-null
  // for any call that reaches acquire() or release() after plugin installation.
  let _engine: GwenEngine | null = null;

  const _available: EntityId[] = [];
  const _active = new Set<EntityId>();
  const _pendingRelease = new DeferredReleaseQueue();

  let _peakActive = 0;
  let _acquireCount = 0;

  const _hooks = createHooks<PoolHooks>();

  // ─── internal helpers ──────────────────────────────────────────────────────

  function _getEngine(): GwenEngine {
    if (!_engine) {
      throw new Error(
        `[GWEN] pool(${actorName}).acquire() or release() was called before the pool plugin was installed.\n` +
          `  Fix: await engine.use(pool._plugin) before calling pool methods.\n` +
          `  Make sure engine.use(Actor._plugin) is called first.`,
      );
    }
    return _engine;
  }

  function _checkThresholds(engine: GwenEngine): void {
    const ratio = _active.size / size;
    const log = engine.logger.child(`pool:${actorName}`);

    if (ratio >= criticalThreshold) {
      log.error(`pool at ${Math.round(ratio * 100)}% capacity (${_active.size}/${size})`, {
        active: _active.size,
        size,
        ratio,
      });
      void _hooks.callHook("pool:critical", { active: _active.size, size, ratio });
    } else if (ratio >= warnThreshold) {
      log.warn(`pool at ${Math.round(ratio * 100)}% capacity (${_active.size}/${size})`, {
        active: _active.size,
        size,
        ratio,
      });
      void _hooks.callHook("pool:warn", { active: _active.size, size, ratio });
    }
  }

  // ─── acquire ───────────────────────────────────────────────────────────────

  function acquire(...args: Props extends void ? [] : [props: Props]): EntityId {
    const props = args[0];
    const engine = _getEngine();

    let id: EntityId;

    if (_available.length > 0) {
      id = _available.pop()!;
      const inst = actor._instances.get(id)!;

      // 1. Re-apply prefab defaults.
      for (let i = 0; i < actor._prefab.components.length; i++) {
        const entry = actor._prefab.components[i]!;
        engine.addComponent(id, entry.def, entry.defaults);
      }

      // 2. Remove DormantTag so ECS queries include this entity again.
      engine.removeComponent(id, DormantTag);

      // 3. Resume the scope — frame handlers become active again.
      inst._scope.resume();

      // 4. Fire onReset callbacks with new props.
      for (let i = 0; i < inst._reset.length; i++) {
        inst._reset[i]!(props);
      }

      // 5. Fire onEnable callbacks.
      for (let i = 0; i < inst._enable.length; i++) {
        inst._enable[i]!();
      }
    } else if (_active.size < size) {
      // `ActorPlugin.spawn` uses a rest-tuple overload (`?[] | [Props]`) to enforce
      // required props at the call site. TypeScript cannot collapse that into an
      // optional-argument signature without a cast, so we use one here. The assertion
      // is safe: the pool receives the same `Props` type that the actor was defined with.
      id = actor._plugin.spawn(...args);
      // Store immediate release (bypasses deferred queue) so cascade in a parent's _doRelease
      // completes synchronously within the same afterTick handler.
      _poolReleaseRegistry.set(id, (childId: EntityId) => {
        if (_active.has(childId)) _doRelease(childId);
      });
    } else {
      // All slots are active: pool is exhausted.
      const log = engine.logger.child(`pool:${actorName}`);
      log.error(`pool exhausted — all ${size} slots are active`, { actorName, size });
      void _hooks.callHook("pool:exhausted", { size });
      throw new PoolExhaustedError(actorName, size);
    }

    _active.add(id);
    _acquireCount++;
    if (_active.size > _peakActive) _peakActive = _active.size;

    _checkThresholds(engine);
    void _hooks.callHook("pool:acquire", { id, props });
    return id;
  }

  // ─── release (deferred to end of frame) ────────────────────────────────────

  function release(id: EntityId): void {
    if (!_active.has(id)) return;
    _pendingRelease.enqueue(id); // enqueue is idempotent
  }

  function _doRelease(id: EntityId): void {
    if (!_engine) return;
    const inst = actor._instances.get(id);
    if (!inst) return;

    // 1. Fire onDisable callbacks — before scope is paused.
    for (let i = 0; i < inst._disable.length; i++) {
      inst._disable[i]!();
    }

    // 2. Fire onRelease callbacks.
    for (let i = 0; i < inst._release.length; i++) {
      inst._release[i]!();
    }

    // 3. Cascade to owned children: pooled children are released, others are despawned.
    if (inst._children && inst._children.size > 0) {
      const childIds = [...inst._children];
      inst._children.clear();
      for (const childId of childIds) {
        const childRelease = _poolReleaseRegistry.get(childId);
        if (childRelease) {
          childRelease(childId);
        } else {
          _actorRegistry.get(childId)?.despawn(childId);
        }
      }
    }

    // 5. Pause the scope — silences all frame handlers.
    // release() ends this instance's life, so its isolation entry is dropped.
    // acquire() does not clear isolation of a live instance.
    inst._scope.forgetIsolation();
    inst._scope.pause();

    // 6. Add DormantTag so ECS queries exclude this entity.
    _engine.addComponent(id, DormantTag, {});

    // 7. Move from active to available.
    _active.delete(id);
    _available.push(id);

    void _hooks.callHook("pool:release", { id });
  }

  // ─── destroyAll ─────────────────────────────────────────────────────────────

  function destroyAll(): void {
    // Flush any pending deferred releases first.
    _pendingRelease.flush(_doRelease);

    // Destroy all dormant slots.
    for (let i = 0; i < _available.length; i++) {
      const id = _available[i]!;
      const inst = actor._instances.get(id);
      // Resume the scope so onDestroy can fire normally during despawn.
      if (inst) inst._scope.resume();
      actor._plugin.despawn!(id);
    }
    _available.length = 0;

    // Destroy all active slots.
    for (const id of _active) {
      actor._plugin.despawn!(id);
    }
    _active.clear();
  }

  // ─── stats ──────────────────────────────────────────────────────────────────

  function stats(): PoolStats {
    return {
      size,
      active: _active.size,
      available: _available.length,
      peakActive: _peakActive,
      acquireCount: _acquireCount,
    };
  }

  // ─── plugin ─────────────────────────────────────────────────────────────────

  const _plugin: GwenPlugin = {
    name: `pool:${actorName}`,
    teardown(): void {
      // Reset all mutable state so the pool closure is ready for re-registration.
      // Entities were already destroyed by the engine:stop hook (scope: "global") or
      // by an explicit destroyAll() call before unuse(). We only need to clear
      // the internal bookkeeping here.
      _engine = null;
      _available.length = 0;
      _active.clear();
      _peakActive = 0;
      _acquireCount = 0;
    },
    setup(engine: GwenEngineBase): void {
      _engine = engine as GwenEngine;

      // Flush deferred releases at the end of each frame (mid-frame safety).
      useHook("engine:afterTick", () => {
        _pendingRelease.flush(_doRelease);
      });

      // Global scope: auto-cleanup when the engine stops.
      if (options.scope === "global") {
        useHook("engine:stop", () => destroyAll());
      }

      // Custom scope: delegate mount/unmount to the caller.
      if (options.scope && typeof options.scope === "object") {
        const scope = options.scope;
        scope.onMount(pool);
        useHook("engine:stop", () => {
          scope.onUnmount(pool);
        });
      }
    },
  };

  const pool: ActorPool<Props, PublicAPI> = {
    _plugin,
    _actorPlugin: actor._plugin,
    actorName,
    acquire,
    release,
    destroyAll,
    stats,
    hooks: _hooks,
  };

  return pool;
}

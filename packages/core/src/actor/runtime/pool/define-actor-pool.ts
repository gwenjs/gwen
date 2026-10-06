import { createHooks } from "hookable";
import type { EntityId } from "../../../engine/engine-api";
import { setEntityDormant, type GwenEngine, type GwenPlugin } from "../../../engine/gwen-engine";
import type { GwenEngineBase } from "@gwenjs/schema";
import { entityIndex } from "../../../types/entity";
import type { ActorDefinition } from "../types";
import { PoolExhaustedError } from "./errors";
import type { ActorPool, ActorPoolDefinition, PoolHooks, PoolOptions, PoolStats } from "./types";
import { useHook } from "../../../hooks/use-hook";
import { actorTablesFor } from "../define-actor";
import { ActorErrorCodes, GwenActorError } from "../../../engine/engine-errors";
import { reportRejectedHook } from "../../../hooks/report-rejected-hook.js";

/**
 * Deferred releases. Two id buffers swap on flush so a release() inside a
 * callback lands in the other buffer and waits for the next flush.
 * Dedup is a per-slot byte and a queue position, allocated once `maxEntities`
 * is known. A recycled generation replaces the queued id in that slot.
 * `onRelease` also runs inside `acquire()` when that replacement happens,
 * not only when `release()` is flushed.
 *
 * @internal
 */
class DeferredReleaseQueue {
  private readonly _bufA: EntityId[];
  private readonly _bufB: EntityId[];
  private _fill: EntityId[];
  private _drain: EntityId[];
  private _fillCount = 0;
  private _flags: Uint8Array | null = null;
  private _pos: Int32Array | null = null;

  constructor(capacity: number) {
    this._bufA = new Array(capacity);
    this._bufB = new Array(capacity);
    this._fill = this._bufA;
    this._drain = this._bufB;
  }

  bind(maxEntities: number): void {
    this._flags = new Uint8Array(maxEntities);
    this._pos = new Int32Array(maxEntities);
    this._pos.fill(-1);
  }

  enqueue(id: EntityId): boolean {
    const flags = this._flags;
    const pos = this._pos;
    if (!flags || !pos) return false;
    const index = entityIndex(id);
    if (index >= flags.length) return false;
    if (flags[index] === 1) {
      const at = pos[index] ?? -1;
      if (at < 0 || at >= this._fillCount) return false;
      const queued = this._fill[at];
      if (queued === id) return false;
      if (queued !== undefined && entityIndex(queued) === index) {
        this._fill[at] = id;
        return true;
      }
      return false;
    }
    flags[index] = 1;
    pos[index] = this._fillCount;
    this._fill[this._fillCount] = id;
    this._fillCount += 1;
    return true;
  }

  /**
   * Swap buffers, clear dedup flags, then call `releaseFn`.
   * A release() from inside `releaseFn` is processed on the next flush.
   */
  flush(releaseFn: (id: EntityId) => void): void {
    if (this._fillCount === 0) return;
    const flags = this._flags;
    const draining = this._fill;
    const count = this._fillCount;
    this._fill = this._drain;
    this._drain = draining;
    this._fillCount = 0;
    if (flags) {
      const pos = this._pos;
      for (let i = 0; i < count; i += 1) {
        const index = entityIndex(draining[i]!);
        flags[index] = 0;
        if (pos) pos[index] = -1;
      }
    }
    for (let i = 0; i < count; i += 1) releaseFn(draining[i]!);
  }

  reset(): void {
    this._fillCount = 0;
    this._flags?.fill(0);
    this._pos?.fill(-1);
  }
}

const actorPlugins = new WeakMap<object, GwenPlugin>();

/** Actor plugin stored for `useActorPool()`. Not part of the public pool handle. */
export function actorPluginOf(pool: object): GwenPlugin {
  const plugin = actorPlugins.get(pool);
  if (!plugin) {
    throw new GwenActorError(
      ActorErrorCodes.PLUGIN_NOT_READY,
      "[GWEN] useActorPool() received a pool that has no actor plugin.",
    );
  }
  return plugin;
}

type PoolListener = PoolHooks[keyof PoolHooks];

/**
 * Mirror of the listener list hookable keeps per pool hook, in the same order.
 * The hot path reads `.length` instead of hookable's private `_hooks`.
 */
interface ListenerLists {
  acquire: PoolListener[];
  release: PoolListener[];
  warn: PoolListener[];
  critical: PoolListener[];
  exhausted: PoolListener[];
}

function listOf(lists: ListenerLists, name: keyof PoolHooks): PoolListener[] {
  switch (name) {
    case "pool:acquire":
      return lists.acquire;
    case "pool:release":
      return lists.release;
    case "pool:warn":
      return lists.warn;
    case "pool:critical":
      return lists.critical;
    case "pool:exhausted":
      return lists.exhausted;
  }
}

/**
 * Creates an actor pool for reusing ECS entities instead of destroying and
 * recreating them on each spawn cycle.
 *
 * Entities are allocated lazily on demand up to `options.size`. Once released,
 * a slot becomes dormant and is reused by the next `acquire()` call. After
 * warm-up, that reuse keeps the entity and does not change the component set.
 * It still allocates.
 * Releases are deferred to the end of the current frame.
 *
 * Install the actor plugin, then the pool plugin:
 * ```ts
 * await engine.use(Actor._plugin)
 * await engine.use(EnemyPool.plugin)
 * ```
 *
 * @param actor - The actor definition to pool (result of `defineActor()`).
 * @param options - Pool configuration.
 * @returns A pool definition. `useActorPool()` returns the public handle.
 *
 * ### Dormancy behaviour
 *
 * A released actor is marked **dormant** until re-acquired. Dormancy is a slot
 * flag, not a component. While dormant:
 *
 * - {@link useHook} handlers are **silently skipped**.
 * - ECS queries skip the entity. The component set is unchanged.
 * - `onRelease` callbacks fire when `release()` is flushed, and inside
 *   `acquire()` when a new id replaces the id stored in that slot.
 * - `onReset` callbacks fire when the slot is re-acquired with `acquire()`.
 */
export function defineActorPool<Props, PublicAPI>(
  actor: ActorDefinition<Props, PublicAPI>,
  options: PoolOptions,
): ActorPoolDefinition<Props, PublicAPI> {
  const { size, warnThreshold = 0.8, criticalThreshold = 0.95 } = options;
  // Integer cuts. The hot path must not divide into a fresh float.
  const warnAt = Math.ceil(warnThreshold * size);
  const criticalAt = Math.ceil(criticalThreshold * size);
  const actorName = actor.__actorName__;
  const hookSource = `pool:${actorName}`;

  let _engine: GwenEngine | null = null;
  // CustomScope takes ActorPool<unknown, unknown>. A generic definition is not
  // assignable to that, so mount receives the base handle type.
  const asHandle = (value: ActorPoolDefinition<Props, PublicAPI>): ActorPool<Props, PublicAPI> =>
    value;

  const available: EntityId[] = new Array(size);
  let availableCount = 0;
  const activeIds: EntityId[] = new Array(size);
  let activeCount = 0;
  let activeFlag: Uint8Array | null = null;
  let activeSlot: Int32Array | null = null;
  const pendingRelease = new DeferredReleaseQueue(size);

  let peakActive = 0;
  let acquireCount = 0;

  const hooks = createHooks<PoolHooks>();
  const listeners: ListenerLists = {
    acquire: [],
    release: [],
    warn: [],
    critical: [],
    exhausted: [],
  };
  // hookable's own unsubscribe, removeHooks and hookOnce all go through
  // `this.removeHook`, so this override sees every single removal once.
  // Like hookable, one removal drops the first matching registration.
  const rawHook = hooks.hook.bind(hooks);
  const rawBeforeEach = hooks.beforeEach.bind(hooks);
  const rawAfterEach = hooks.afterEach.bind(hooks);
  let spyCount = 0;
  hooks.hook = (name, fn, hookOptions) => {
    const off = rawHook(name, fn, hookOptions);
    if (typeof fn === "function") listOf(listeners, name).push(fn);
    return off;
  };
  const rawRemoveHook = hooks.removeHook.bind(hooks);
  hooks.removeHook = (name, fn) => {
    const list = listOf(listeners, name);
    const at = list.indexOf(fn);
    if (at >= 0) list.splice(at, 1);
    rawRemoveHook(name, fn);
  };
  hooks.beforeEach = (fn) => {
    spyCount += 1;
    const off = rawBeforeEach(fn);
    let open = true;
    return () => {
      if (!open) return;
      open = false;
      spyCount -= 1;
      off();
    };
  };
  hooks.afterEach = (fn) => {
    spyCount += 1;
    const off = rawAfterEach(fn);
    let open = true;
    return () => {
      if (!open) return;
      open = false;
      spyCount -= 1;
      off();
    };
  };
  const rawClear = hooks.clearHook.bind(hooks);
  hooks.clearHook = (name) => {
    listOf(listeners, name).length = 0;
    rawClear(name);
  };
  const rawRemoveAll = hooks.removeAllHooks.bind(hooks);
  hooks.removeAllHooks = () => {
    listeners.acquire.length = 0;
    listeners.release.length = 0;
    listeners.warn.length = 0;
    listeners.critical.length = 0;
    listeners.exhausted.length = 0;
    rawRemoveAll();
  };

  // No listener and no before/after spy: callHook would only allocate.
  function callAcquire(id: EntityId, props: unknown): void {
    if (listeners.acquire.length === 0 && spyCount === 0) return;
    reportRejectedHook(
      _engine,
      hookSource,
      "pool:acquire",
      hooks.callHook("pool:acquire", { id, props }),
    );
  }

  function callRelease(id: EntityId): void {
    if (listeners.release.length === 0 && spyCount === 0) return;
    reportRejectedHook(_engine, hookSource, "pool:release", hooks.callHook("pool:release", { id }));
  }

  function callPressure(name: "pool:warn" | "pool:critical", active: number, ratio: number): void {
    if (listOf(listeners, name).length === 0 && spyCount === 0) return;
    reportRejectedHook(_engine, hookSource, name, hooks.callHook(name, { active, size, ratio }));
  }

  function callExhausted(): void {
    if (listeners.exhausted.length === 0 && spyCount === 0) return;
    reportRejectedHook(
      _engine,
      hookSource,
      "pool:exhausted",
      hooks.callHook("pool:exhausted", { size }),
    );
  }

  function isActive(id: EntityId): boolean {
    const flags = activeFlag;
    const slots = activeSlot;
    if (!flags || !slots) return false;
    const index = entityIndex(id);
    if (index >= flags.length || flags[index] !== 1) return false;
    const slot = slots[index] ?? -1;
    return slot >= 0 && slot < activeCount && activeIds[slot] === id;
  }

  function releaseSuperseded(id: EntityId): void {
    const inst = actor._instances.get(id);
    if (!inst) return;

    for (let i = 0; i < inst._disable.length; i += 1) inst._disable[i]!();
    for (let i = 0; i < inst._release.length; i += 1) inst._release[i]!();

    if (inst._children && inst._children.size > 0) {
      const childIds = [...inst._children];
      inst._children.clear();
      const tables = _engine ? actorTablesFor(_engine) : undefined;
      for (const childId of childIds) {
        const childRelease = tables?.poolRelease.get(childId);
        if (childRelease) childRelease(childId);
        else tables?.actors.get(childId)?.despawn(childId);
      }
    }

    inst._scope.forgetIsolation();
    inst._scope.pause();
    callRelease(id);
  }

  function activate(id: EntityId): void {
    const flags = activeFlag;
    const slots = activeSlot;
    if (!flags || !slots) return;
    const index = entityIndex(id);
    if (index < flags.length && flags[index] === 1) {
      const slot = slots[index] ?? -1;
      if (slot >= 0 && slot < activeCount) {
        const previous = activeIds[slot];
        if (previous !== undefined && previous !== id) {
          activeIds[slot] = id;
          releaseSuperseded(previous);
        }
      }
      return;
    }
    flags[index] = 1;
    slots[index] = activeCount;
    activeIds[activeCount] = id;
    activeCount += 1;
  }

  function deactivate(id: EntityId): void {
    const flags = activeFlag;
    const slots = activeSlot;
    if (!flags || !slots) return;
    const index = entityIndex(id);
    if (index >= flags.length || flags[index] !== 1) return;
    const slot = slots[index] ?? -1;
    if (slot < 0 || slot >= activeCount || activeIds[slot] !== id) return;
    const last = activeCount - 1;
    const moved = activeIds[last];
    if (moved !== undefined && last !== slot) {
      activeIds[slot] = moved;
      slots[entityIndex(moved)] = slot;
    }
    activeCount = last;
    flags[index] = 0;
    slots[index] = -1;
  }

  function _getEngine(): GwenEngine {
    if (!_engine) {
      throw new GwenActorError(
        ActorErrorCodes.PLUGIN_NOT_READY,
        `[GWEN] pool(${actorName}).acquire() or release() was called before the pool plugin was installed.\n` +
          `  Fix: await engine.use(pool.plugin) before calling pool methods.\n` +
          `  Make sure engine.use(Actor._plugin) is called first.`,
      );
    }
    return _engine;
  }

  function _checkThresholds(engine: GwenEngine): void {
    if (activeCount < warnAt) return;
    const ratio = activeCount / size;
    const log = engine.logger.child(`pool:${actorName}`);
    if (activeCount >= criticalAt) {
      log.error(`pool at ${Math.round(ratio * 100)}% capacity (${activeCount}/${size})`, {
        active: activeCount,
        size,
        ratio,
      });
      callPressure("pool:critical", activeCount, ratio);
    } else {
      log.warn(`pool at ${Math.round(ratio * 100)}% capacity (${activeCount}/${size})`, {
        active: activeCount,
        size,
        ratio,
      });
      callPressure("pool:warn", activeCount, ratio);
    }
  }

  // A rest parameter allocates an array on every call, including acquire().
  function acquire(props?: Props): EntityId {
    const engine = _getEngine();
    let id: EntityId | undefined;

    while (availableCount > 0) {
      availableCount -= 1;
      const candidate = available[availableCount]!;
      // A dead id fails this write and is dropped. The slot stays dormant
      // while component defaults, then prefab defaults, are written into the
      // existing component objects.
      // Reuse does not add or remove a component and does not invalidate queries:
      // a prefab component removed during the previous life stays removed.
      if (!setEntityDormant(engine, candidate, true)) continue;
      const inst = actor._instances.get(candidate);
      if (!inst) continue;
      const entries = actor._prefab.components;
      for (let i = 0; i < entries.length; i += 1) {
        const entry = entries[i]!;
        const existing = engine.getComponent(candidate, entry.def);
        if (existing === undefined) continue;
        // Same order as a fresh spawn: component defaults, then the prefab entry.
        if (entry.def.defaults) Object.assign(existing, entry.def.defaults);
        Object.assign(existing, entry.defaults);
      }
      if (!setEntityDormant(engine, candidate, false)) continue;
      inst._scope.resume();
      for (let i = 0; i < inst._reset.length; i += 1) inst._reset[i]!(props);
      for (let i = 0; i < inst._enable.length; i += 1) inst._enable[i]!();
      id = candidate;
      break;
    }

    if (id === undefined) {
      if (activeCount < size) {
        const spawnActor = actor._plugin.spawn as (next?: Props) => EntityId;
        id = spawnActor(props);
        const spawned = id;
        actorTablesFor(engine).poolRelease.set(spawned, (childId: EntityId) => {
          if (isActive(childId)) _doRelease(childId);
        });
      } else {
        const log = engine.logger.child(`pool:${actorName}`);
        log.error(`pool exhausted — all ${size} slots are active`, { actorName, size });
        callExhausted();
        throw new PoolExhaustedError(actorName, size);
      }
    }

    activate(id);
    acquireCount += 1;
    if (activeCount > peakActive) peakActive = activeCount;
    _checkThresholds(engine);
    callAcquire(id, props);
    return id;
  }

  function release(id: EntityId): void {
    if (!isActive(id)) return;
    pendingRelease.enqueue(id);
  }

  function _doRelease(id: EntityId): void {
    if (!isActive(id)) return;
    const inst = actor._instances.get(id);
    if (!inst || !_engine) {
      deactivate(id);
      return;
    }

    for (let i = 0; i < inst._disable.length; i += 1) inst._disable[i]!();
    for (let i = 0; i < inst._release.length; i += 1) inst._release[i]!();

    if (inst._children && inst._children.size > 0) {
      const childIds = [...inst._children];
      inst._children.clear();
      const tables = _engine ? actorTablesFor(_engine) : undefined;
      for (const childId of childIds) {
        const childRelease = tables?.poolRelease.get(childId);
        if (childRelease) childRelease(childId);
        else tables?.actors.get(childId)?.despawn(childId);
      }
    }

    inst._scope.forgetIsolation();
    inst._scope.pause();

    const stillAlive = setEntityDormant(_engine, id, true);
    deactivate(id);
    if (stillAlive) {
      available[availableCount] = id;
      availableCount += 1;
    }
    callRelease(id);
  }

  function destroyAll(): void {
    pendingRelease.flush(_doRelease);
    for (let i = 0; i < availableCount; i += 1) {
      const id = available[i]!;
      const inst = actor._instances.get(id);
      if (inst) inst._scope.resume();
      actor._plugin.despawn!(id);
    }
    availableCount = 0;
    for (let i = 0; i < activeCount; i += 1) actor._plugin.despawn!(activeIds[i]!);
    activeCount = 0;
    activeFlag?.fill(0);
    activeSlot?.fill(-1);
    pendingRelease.reset();
  }

  function stats(): PoolStats {
    return {
      size,
      active: activeCount,
      available: availableCount,
      peakActive,
      acquireCount,
    };
  }

  const plugin: GwenPlugin = {
    name: hookSource,
    teardown(): void {
      _engine = null;
      availableCount = 0;
      activeCount = 0;
      peakActive = 0;
      acquireCount = 0;
      activeFlag?.fill(0);
      activeSlot?.fill(-1);
      pendingRelease.reset();
    },
    setup(engine: GwenEngineBase): void {
      _engine = engine as GwenEngine;
      const maxEntities = _engine.maxEntities;
      activeFlag = new Uint8Array(maxEntities);
      activeSlot = new Int32Array(maxEntities);
      activeSlot.fill(-1);
      pendingRelease.bind(maxEntities);

      useHook("engine:afterTick", () => {
        pendingRelease.flush(_doRelease);
      });

      if (options.scope === "global") {
        useHook("engine:stop", () => destroyAll());
      }

      if (options.scope && typeof options.scope === "object") {
        const scope = options.scope;
        scope.onMount(asHandle(pool));
        useHook("engine:stop", () => {
          scope.onUnmount(asHandle(pool));
        });
      }
    },
  };

  const pool: ActorPoolDefinition<Props, PublicAPI> = {
    plugin,
    actorName,
    acquire,
    release,
    destroyAll,
    stats,
    hooks,
  };
  actorPlugins.set(pool, actor._plugin);
  return pool;
}

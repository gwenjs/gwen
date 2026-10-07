import { createHooks } from "hookable";
import type { EntityId } from "../../../engine/engine-api";
import { setEntityDormant, type GwenEngine, type GwenPlugin } from "../../../engine/gwen-engine";
import type { GwenEngineBase } from "@gwenjs/schema";
import { entityIndex } from "../../../types/entity";
import type { ActorDefinition } from "../types";
import { PoolExhaustedError } from "./errors";
import type { ActorPool, ActorPoolDefinition, PoolHooks, PoolOptions, PoolStats } from "./types";
import { useHook } from "../../../hooks/use-hook";
import { _actorRegistry, _poolReleaseRegistry } from "../define-actor";
import { ActorErrorCodes, GwenActorError } from "../../../engine/engine-errors";
import { reportRejectedHook } from "../../../hooks/report-rejected-hook.js";

/**
 * Deferred releases. Two id buffers swap on flush so a release() inside a
 * callback lands in the other buffer and waits for the next flush.
 * Dedup is a per-slot byte and a queue position, allocated once `maxEntities`
 * is known. A recycled generation replaces the queued id in that slot.
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

interface ListenerCounts {
  acquire: number;
  release: number;
  warn: number;
  critical: number;
  exhausted: number;
}

function countOf(counts: ListenerCounts, name: keyof PoolHooks): number {
  switch (name) {
    case "pool:acquire":
      return counts.acquire;
    case "pool:release":
      return counts.release;
    case "pool:warn":
      return counts.warn;
    case "pool:critical":
      return counts.critical;
    case "pool:exhausted":
      return counts.exhausted;
  }
}

function addCount(counts: ListenerCounts, name: keyof PoolHooks, delta: number): void {
  switch (name) {
    case "pool:acquire":
      counts.acquire = Math.max(0, counts.acquire + delta);
      break;
    case "pool:release":
      counts.release = Math.max(0, counts.release + delta);
      break;
    case "pool:warn":
      counts.warn = Math.max(0, counts.warn + delta);
      break;
    case "pool:critical":
      counts.critical = Math.max(0, counts.critical + delta);
      break;
    case "pool:exhausted":
      counts.exhausted = Math.max(0, counts.exhausted + delta);
      break;
  }
}

function zeroCount(counts: ListenerCounts, name: keyof PoolHooks): void {
  addCount(counts, name, -countOf(counts, name));
}

/**
 * Creates an actor pool for reusing ECS entities instead of destroying and
 * recreating them on each spawn cycle.
 *
 * Entities are allocated lazily on demand up to `options.size`. Once released,
 * a slot becomes dormant and is reused by the next `acquire()` call. After
 * warm-up, that reuse allocates nothing and does not change the component set.
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
 * - `onRelease` callbacks fire when `release()` is flushed.
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
  const listeners: ListenerCounts = { acquire: 0, release: 0, warn: 0, critical: 0, exhausted: 0 };
  const rawHook = hooks.hook.bind(hooks);
  const rawBeforeEach = hooks.beforeEach.bind(hooks);
  const rawAfterEach = hooks.afterEach.bind(hooks);
  let spyCount = 0;
  interface OpenListener {
    name: keyof PoolHooks;
    fn: PoolHooks[keyof PoolHooks];
    open: boolean;
  }
  const openListeners: OpenListener[] = [];
  function retire(listener: OpenListener, decrement: boolean): void {
    if (!listener.open) return;
    listener.open = false;
    const at = openListeners.indexOf(listener);
    if (at >= 0) openListeners.splice(at, 1);
    if (decrement) addCount(listeners, listener.name, -1);
  }
  function retireName(name: keyof PoolHooks): void {
    for (let i = openListeners.length - 1; i >= 0; i -= 1) {
      const listener = openListeners[i]!;
      if (listener.name === name) retire(listener, false);
    }
  }
  hooks.hook = (name, fn, hookOptions) => {
    if (typeof fn !== "function") return rawHook(name, fn, hookOptions);
    addCount(listeners, name, 1);
    const off = rawHook(name, fn, hookOptions);
    const listener: OpenListener = { name, fn, open: true };
    openListeners.push(listener);
    return () => {
      if (!listener.open) return;
      retire(listener, true);
      off();
    };
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
    retireName(name);
    zeroCount(listeners, name);
    rawClear(name);
  };
  const rawRemoveAll = hooks.removeAllHooks.bind(hooks);
  hooks.removeAllHooks = () => {
    for (let i = openListeners.length - 1; i >= 0; i -= 1) {
      retire(openListeners[i]!, false);
    }
    listeners.acquire = 0;
    listeners.release = 0;
    listeners.warn = 0;
    listeners.critical = 0;
    listeners.exhausted = 0;
    rawRemoveAll();
  };
  const rawRemoveHook = hooks.removeHook.bind(hooks);
  hooks.removeHook = (name, fn) => {
    for (let i = openListeners.length - 1; i >= 0; i -= 1) {
      const listener = openListeners[i]!;
      if (listener.name === name && listener.fn === fn) retire(listener, true);
    }
    rawRemoveHook(name, fn);
  };
  const rawRemoveHooks = hooks.removeHooks.bind(hooks);
  hooks.removeHooks = (config) => {
    rawRemoveHooks(config);
  };

  // No listener and no before/after spy: callHook would only allocate.
  function callAcquire(id: EntityId, props: unknown): void {
    if (listeners.acquire === 0 && spyCount === 0) return;
    reportRejectedHook(
      _engine,
      hookSource,
      "pool:acquire",
      hooks.callHook("pool:acquire", { id, props }),
    );
  }

  function callRelease(id: EntityId): void {
    if (listeners.release === 0 && spyCount === 0) return;
    reportRejectedHook(_engine, hookSource, "pool:release", hooks.callHook("pool:release", { id }));
  }

  function callPressure(name: "pool:warn" | "pool:critical", active: number, ratio: number): void {
    if (countOf(listeners, name) === 0 && spyCount === 0) return;
    reportRejectedHook(_engine, hookSource, name, hooks.callHook(name, { active, size, ratio }));
  }

  function callExhausted(): void {
    if (listeners.exhausted === 0 && spyCount === 0) return;
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
      for (const childId of childIds) {
        const childRelease = _poolReleaseRegistry.get(childId);
        if (childRelease) childRelease(childId);
        else _actorRegistry.get(childId)?.despawn(childId);
      }
    }

    inst._scope.forgetIsolation();
    inst._scope.pause();
    if (listeners.release > 0) void hooks.callHook("pool:release", { id });
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
      // A dead id fails this write and is dropped. The slot stays dormant.
      // Reuse does not add or remove a component.
      if (!setEntityDormant(engine, candidate, true)) continue;
      const inst = actor._instances.get(candidate);
      if (!inst) continue;
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
        _poolReleaseRegistry.set(spawned, (childId: EntityId) => {
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
      for (const childId of childIds) {
        const childRelease = _poolReleaseRegistry.get(childId);
        if (childRelease) childRelease(childId);
        else _actorRegistry.get(childId)?.despawn(childId);
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

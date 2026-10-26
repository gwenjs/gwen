import type { Hookable } from "hookable";
import type { GwenPrefabExtensions } from "@gwenjs/schema";

import type { EntityId } from "./engine-api";
import { popEngine, pushEngine, unwrapEngine } from "./engine-local";
import { readLoopDepth } from "./engine-internals.js";
import { afterPendingEntityOps } from "./engine-entities.js";
import { isThenable } from "./error-isolation.js";
import { CoreErrorCodes } from "./engine-errors.js";
import type { GwenEngine } from "./engine-types.js";
import type { GwenRuntimeHooks } from "./runtime-hooks";
import { createEntityId } from "../types/entity.js";

type EngineHookFn = (...args: unknown[]) => unknown;

/**
 * Run hook handlers one after another with the engine context pushed.
 * A thenable pauses the rest of the list until it settles.
 */
export function callHooksWithEngine(
  engine: GwenEngine,
  hooks: readonly EngineHookFn[],
  args: readonly unknown[],
  start: number,
): unknown {
  for (let i = start; i < hooks.length; i++) {
    const hook = hooks[i];
    if (hook === undefined) continue;
    const previous = pushEngine(engine);
    try {
      const result = hook(...args);
      if (isThenable(result)) {
        return Promise.resolve(result)
          .then(() => callHooksWithEngine(engine, hooks, args, i + 1))
          .finally(() => popEngine(engine, previous));
      }
    } catch (error) {
      popEngine(engine, previous);
      return Promise.reject(error);
    }
    popEngine(engine, previous);
  }
  return undefined;
}

/** Run every handler at once. Each one pushes the engine context around its own call. */
export function callHooksWithEngineParallel(
  engine: GwenEngine,
  hooks: readonly EngineHookFn[],
  args: readonly unknown[],
): unknown {
  if (hooks.length === 0) return undefined;
  return Promise.all(
    hooks.map((hook) => {
      const previous = pushEngine(engine);
      try {
        const result = hook(...args);
        if (isThenable(result)) {
          return Promise.resolve(result).finally(() => popEngine(engine, previous));
        }
        popEngine(engine, previous);
        return result;
      } catch (error) {
        popEngine(engine, previous);
        return Promise.reject(error);
      }
    }),
  );
}

/**
 * Install the serial and parallel runners once.
 * `callHookWith.bind` happens here, not on each frame.
 */
export function bindEngineOnHooks(engine: GwenEngine, hooks: Hookable<GwenRuntimeHooks>): void {
  const callWith = hooks.callHookWith.bind(hooks);
  const runSerial = (list: readonly EngineHookFn[], hookArgs: readonly unknown[]): unknown =>
    callHooksWithEngine(engine, list, hookArgs, 0);
  const runParallel = (list: readonly EngineHookFn[], hookArgs: readonly unknown[]): unknown =>
    callHooksWithEngineParallel(engine, list, hookArgs);
  hooks.callHook = ((name, ...args) => callWith(runSerial, name, args)) as typeof hooks.callHook;
  hooks.callHookParallel = ((name, ...args) =>
    callWith(runParallel, name, args)) as typeof hooks.callHookParallel;
}

/**
 * `entity:destroy` handlers see `engine` as current.
 * A rejected handler is reported. It does not stop the other handlers.
 */
export function emitEntityDestroy(
  engine: GwenEngine,
  hooks: Hookable<GwenRuntimeHooks>,
  reportFailure: (id: EntityId, error: unknown) => void,
  id: EntityId,
): unknown {
  let failure: unknown;
  hooks.callHookWith(
    (hookList, args) => {
      for (const handler of hookList) {
        const previous = pushEngine(engine);
        try {
          const result = handler(...args);
          if (result instanceof Promise) {
            void result.catch((error: unknown) => {
              reportFailure(id, error);
            });
          }
        } catch (error) {
          reportFailure(id, error);
          if (failure === undefined) failure = error;
        } finally {
          popEngine(engine, previous);
        }
      }
    },
    "entity:destroy",
    [id],
  );
  return failure;
}

const TRACKED_HOOKS = [
  "entity:spawn",
  "actor:enable",
  "actor:disable",
  "prefab:instantiate",
] as const;

type TrackedHook = (typeof TRACKED_HOOKS)[number];

export interface CoreHookCounts {
  listeners: Record<TrackedHook, unknown[]>;
  spyCount: number;
  /** Listeners plus spies. `createEntity` reads `entitySpawn` and skips the call at zero. */
  entitySpawn: number;
  actorEnable: number;
  actorDisable: number;
  prefabInstantiate: number;
}

const coreHookCounts = new WeakMap<object, CoreHookCounts>();

/**
 * Real bus for an engine or for the proxy `plugin.setup` receives.
 * The first lookup resolves it. A repeat lookup is a WeakMap read.
 */
const resolvedHooks = new WeakMap<object, Hookable<GwenRuntimeHooks>>();

function isTrackedHook(name: string): name is TrackedHook {
  for (let index = 0; index < TRACKED_HOOKS.length; index += 1) {
    if (TRACKED_HOOKS[index] === name) return true;
  }
  return false;
}

function emptyCounts(): CoreHookCounts {
  return {
    listeners: {
      "entity:spawn": [],
      "actor:enable": [],
      "actor:disable": [],
      "prefab:instantiate": [],
    },
    spyCount: 0,
    entitySpawn: 0,
    actorEnable: 0,
    actorDisable: 0,
    prefabInstantiate: 0,
  };
}

function syncGate(counts: CoreHookCounts, name: TrackedHook): void {
  const live = counts.listeners[name].length + counts.spyCount;
  if (name === "entity:spawn") counts.entitySpawn = live;
  else if (name === "actor:enable") counts.actorEnable = live;
  else if (name === "actor:disable") counts.actorDisable = live;
  else counts.prefabInstantiate = live;
}

function syncSpies(counts: CoreHookCounts): void {
  for (const name of TRACKED_HOOKS) syncGate(counts, name);
}

/**
 * Count listeners for the four core hooks on this hooks object.
 * `hookOnce` and `addHooks` go through `hook`. Spies count as a listener.
 * A hooks object that was never wrapped still dispatches.
 */
export function trackCoreHookListeners(hooks: Hookable<GwenRuntimeHooks>): CoreHookCounts {
  const existing = coreHookCounts.get(hooks);
  if (existing !== undefined) return existing;
  const counts = emptyCounts();
  coreHookCounts.set(hooks, counts);
  const aliases = new Map<string, string>();
  const rawHook = hooks.hook.bind(hooks);
  const rawRemoveHook = hooks.removeHook.bind(hooks);
  const rawClear = hooks.clearHook.bind(hooks);
  const rawRemoveAll = hooks.removeAllHooks.bind(hooks);
  const rawBeforeEach = hooks.beforeEach.bind(hooks);
  const rawAfterEach = hooks.afterEach.bind(hooks);
  const rawDeprecate = hooks.deprecateHook.bind(hooks);
  const rawDeprecateHooks = hooks.deprecateHooks.bind(hooks);

  function resolveTracked(name: string): TrackedHook | undefined {
    let current = name;
    for (let hop = 0; hop < 8; hop += 1) {
      const next = aliases.get(current);
      if (next === undefined) break;
      current = next;
    }
    return isTrackedHook(current) ? current : undefined;
  }

  hooks.hook = (name, fn, hookOptions) => {
    const off = rawHook(name, fn, hookOptions);
    const tracked = typeof fn === "function" ? resolveTracked(name) : undefined;
    if (tracked !== undefined) {
      counts.listeners[tracked].push(fn);
      syncGate(counts, tracked);
    }
    return off;
  };
  hooks.removeHook = (name, fn) => {
    const tracked = resolveTracked(name);
    if (tracked !== undefined) {
      const list = counts.listeners[tracked];
      const at = list.indexOf(fn);
      if (at >= 0) list.splice(at, 1);
      syncGate(counts, tracked);
    }
    rawRemoveHook(name, fn);
  };
  hooks.clearHook = (name) => {
    if (isTrackedHook(name)) {
      counts.listeners[name].length = 0;
      syncGate(counts, name);
    }
    rawClear(name);
  };
  hooks.removeAllHooks = () => {
    for (const name of TRACKED_HOOKS) counts.listeners[name].length = 0;
    syncSpies(counts);
    rawRemoveAll();
  };
  hooks.beforeEach = (fn) => {
    counts.spyCount += 1;
    syncSpies(counts);
    const off = rawBeforeEach(fn);
    let open = true;
    return () => {
      if (!open) return;
      open = false;
      counts.spyCount -= 1;
      syncSpies(counts);
      off();
    };
  };
  hooks.afterEach = (fn) => {
    counts.spyCount += 1;
    syncSpies(counts);
    const off = rawAfterEach(fn);
    let open = true;
    return () => {
      if (!open) return;
      open = false;
      counts.spyCount -= 1;
      syncSpies(counts);
      off();
    };
  };
  hooks.deprecateHook = (name, deprecated) => {
    const to = typeof deprecated === "string" ? deprecated : deprecated.to;
    aliases.set(name, to);
    if (isTrackedHook(name)) {
      counts.listeners[name].length = 0;
      syncGate(counts, name);
    }
    rawDeprecate(name, deprecated);
  };
  hooks.deprecateHooks = (deprecatedHooks) => {
    rawDeprecateHooks(deprecatedHooks);
  };
  return counts;
}

function hooksOf(engine: GwenEngine): Hookable<GwenRuntimeHooks> {
  const cached = resolvedHooks.get(engine);
  if (cached !== undefined) return cached;
  const hooks = unwrapEngine(engine).hooks;
  resolvedHooks.set(engine, hooks);
  return hooks;
}

function liveCount(counts: CoreHookCounts, name: TrackedHook): number {
  if (name === "entity:spawn") return counts.entitySpawn;
  if (name === "actor:enable") return counts.actorEnable;
  if (name === "actor:disable") return counts.actorDisable;
  return counts.prefabInstantiate;
}

/** No listener and no spy: callers must not build an argument array. */
function mustDispatch(hooks: Hookable<GwenRuntimeHooks>, name: TrackedHook): boolean {
  const counts = coreHookCounts.get(hooks);
  if (counts === undefined) return true;
  return liveCount(counts, name) !== 0;
}

function reportHookFailure(engine: GwenEngine, source: string, id: EntityId, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  engine.errors.emit({
    level: "error",
    code: CoreErrorCodes.PLUGIN_RUNTIME_ERROR,
    message,
    source,
    error,
    context: { entityId: id },
  });
}

function isolateHook<Args extends readonly unknown[]>(
  engine: GwenEngine,
  id: EntityId,
  source: string,
  handler: (...handlerArgs: Args) => unknown,
  handlerArgs: Args,
): void {
  const previous = pushEngine(engine);
  try {
    const result = handler(...handlerArgs);
    if (result instanceof Promise) {
      void result.catch((error: unknown) => {
        reportHookFailure(engine, source, id, error);
      });
    }
  } catch (error) {
    reportHookFailure(engine, source, id, error);
  } finally {
    popEngine(engine, previous);
  }
}

function fireEntitySpawn(
  engine: GwenEngine,
  hooks: Hookable<GwenRuntimeHooks>,
  id: EntityId,
): void {
  if (!mustDispatch(hooks, "entity:spawn")) return;
  const args: [EntityId] = [id];
  hooks.callHookWith(
    (hookList) => {
      for (const handler of hookList) {
        isolateHook(engine, id, "entity:spawn", handler, args);
      }
    },
    "entity:spawn",
    args,
  );
}

/** `entity:spawn` handlers see `engine` as current. A handler failure is reported. */
export function emitEntitySpawn(engine: GwenEngine, id: EntityId): void {
  const hooks = hooksOf(engine);
  fireEntitySpawn(engine, hooks, id);
}

/** One listener check, then one `entity:spawn` per accepted id. */
export function emitBulkSpawn(
  engine: GwenEngine,
  spawned: Uint32Array,
  generations: Uint32Array,
): void {
  const batchHooks = hooksOf(engine);
  if (!mustDispatch(batchHooks, "entity:spawn")) return;
  for (let cursor = 0; cursor < spawned.length; cursor += 1) {
    fireEntitySpawn(
      engine,
      batchHooks,
      createEntityId(spawned[cursor] ?? 0, generations[cursor] ?? 0),
    );
  }
}

/** `actor:enable` for a pooled actor that was acquired again. */
export function emitActorEnable(engine: GwenEngine, id: EntityId): void {
  const actorHooks = hooksOf(engine);
  if (!mustDispatch(actorHooks, "actor:enable")) return;
  const args: [EntityId] = [id];
  actorHooks.callHookWith(
    (hookList) => {
      for (const handler of hookList) {
        isolateHook(engine, id, "actor:enable", handler, args);
      }
    },
    "actor:enable",
    args,
  );
}

/** `actor:disable` for a pooled actor that was released. */
export function emitActorDisable(engine: GwenEngine, id: EntityId): void {
  const disableHooks = hooksOf(engine);
  if (!mustDispatch(disableHooks, "actor:disable")) return;
  const args: [EntityId] = [id];
  disableHooks.callHookWith(
    (hookList) => {
      for (const handler of hookList) {
        isolateHook(engine, id, "actor:disable", handler, args);
      }
    },
    "actor:disable",
    args,
  );
}

/** `prefab:instantiate` after the prefab components are on the entity. */
export function emitPrefabInstantiate(
  engine: GwenEngine,
  id: EntityId,
  extensions: Readonly<Partial<GwenPrefabExtensions>>,
): void {
  const prefabHooks = hooksOf(engine);
  if (!mustDispatch(prefabHooks, "prefab:instantiate")) return;
  const args: [EntityId, Readonly<Partial<GwenPrefabExtensions>>] = [id, extensions];
  prefabHooks.callHookWith(
    (hookList) => {
      for (const handler of hookList) {
        isolateHook(engine, id, "prefab:instantiate", handler, args);
      }
    },
    "prefab:instantiate",
    args,
  );
}

/**
 * `prefab:instantiate` after queued creates and adds when a chunk loop is open.
 * No listener and no spy: returns before a closure or a queue slot.
 */
export function queuePrefabInstantiate(
  engine: GwenEngine,
  id: EntityId,
  extensions: Readonly<Partial<GwenPrefabExtensions>>,
): void {
  const prefabHooks = hooksOf(engine);
  if (!mustDispatch(prefabHooks, "prefab:instantiate")) return;
  if (readLoopDepth(engine) > 0) {
    afterPendingEntityOps(engine, () => {
      emitPrefabInstantiate(engine, id, extensions);
    });
    return;
  }
  emitPrefabInstantiate(engine, id, extensions);
}

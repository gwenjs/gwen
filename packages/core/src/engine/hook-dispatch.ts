import type { Hookable } from "hookable";

import type { EntityId } from "./engine-api";
import { popEngine, pushEngine } from "./engine-local";
import { isThenable } from "./error-isolation.js";
import type { GwenEngine } from "./engine-types.js";
import type { GwenRuntimeHooks } from "./runtime-hooks";

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

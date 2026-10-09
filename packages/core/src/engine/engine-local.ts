/**
 * Per-engine state slot.
 *
 * The key is the real engine, never the hooks proxy passed to `plugin.setup()`.
 * The first `get` registers exactly one disposable, released by `stop()`.
 */

import type { GwenEngine } from "./gwen-engine";
import { engineContext, useEngine } from "./context";
import { createDisposable } from "../disposable";

/** Brand on {@link GwenEngineImpl}. The hooks proxy forwards it. */
export const gwenEngineSelf = Symbol.for("@gwenjs/engine");

export function unwrapEngine(engine: GwenEngine): GwenEngine {
  if (gwenEngineSelf in engine) {
    const inner = Reflect.get(engine, gwenEngineSelf);
    if (typeof inner === "object" && inner !== null) {
      return inner as GwenEngine;
    }
  }
  return engine;
}

export interface EngineLocal<T> {
  /** Return this engine's value, creating it on first access. */
  get(engine: GwenEngine): T;
  /** Return the value without creating it. */
  peek(engine: GwenEngine): T | undefined;
  /** `get(useEngine())`. Throws `GwenContextError` `CORE:OUTSIDE_ENGINE_CONTEXT` with no engine. */
  use(): T;
}

export function createEngineLocal<T>(
  init: (engine: GwenEngine) => T,
  dispose?: (value: T, engine: GwenEngine) => void,
): EngineLocal<T> {
  const map = new WeakMap<GwenEngine, { value: T }>();

  function get(engine: GwenEngine): T {
    const real = unwrapEngine(engine);
    const existing = map.get(real);
    if (existing) return existing.value;
    const value = init(real);
    map.set(real, { value });
    real.disposables.add(
      "engine-local",
      createDisposable(() => {
        const current = map.get(real);
        if (!current) return;
        dispose?.(current.value, real);
        map.delete(real);
      }),
    );
    return value;
  }

  function peek(engine: GwenEngine): T | undefined {
    return map.get(unwrapEngine(engine))?.value;
  }

  function use(): T {
    return get(useEngine());
  }

  return { get, peek, use };
}

/**
 * Make `engine` current with replace, and return the engine that was current.
 * Nested calls are allowed. There is no "Context conflict".
 */
export function pushEngine(engine: GwenEngine): GwenEngine | undefined {
  const real = unwrapEngine(engine);
  const previous = engineContext.tryUse();
  engineContext.set(real, true);
  return previous ?? undefined;
}

/**
 * If `engine` is still current, restore `previous` (or clear the slot).
 * A different engine that became current during an await is left alone.
 */
export function popEngine(engine: GwenEngine, previous: GwenEngine | undefined): void {
  const real = unwrapEngine(engine);
  if (engineContext.tryUse() !== real) return;
  if (previous) engineContext.set(unwrapEngine(previous), true);
  else engineContext.unset();
}

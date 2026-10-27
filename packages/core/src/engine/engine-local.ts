/**
 * Per-engine state slot.
 *
 * The key is the real engine, never the hooks proxy passed to `plugin.setup()`.
 * The first `get` registers exactly one disposable, released by `stop()`.
 * Once `stop()` has started disposing, `get` no longer creates a value.
 */

import { GwenError } from "@gwenjs/schema";
import type { GwenEngine } from "./engine-types";
import { engineContext, useEngine } from "./context";
import { createDisposable } from "../disposable";
import { CoreErrorCodes } from "./engine-errors";

/** Brand on {@link GwenEngineImpl}. The hooks proxy forwards it. */
export const gwenEngineSelf = Symbol.for("@gwenjs/engine");

export function unwrapEngine(engine: GwenEngine): GwenEngine {
  // One keyed read. `?.` lets null, undefined and primitives fall through to the creation guard.
  const inner: unknown = (engine as { [gwenEngineSelf]?: unknown } | null | undefined)?.[
    gwenEngineSelf
  ];
  return typeof inner === "object" && inner !== null ? (inner as GwenEngine) : engine;
}

function describeNonEngine(value: unknown): string {
  if (value === null) return "null";
  const kind = typeof value;
  if (kind === "object" || kind === "function") return "an object without disposables.add()";
  return kind;
}

export interface EngineLocal<T> {
  /**
   * Return this engine's value, creating it on first access.
   * Throws `CORE:INVALID_ENGINE`, `CORE:ENGINE_LOCAL_REENTRANT`, or `CORE:ENGINE_DISPOSED`.
   */
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
  // Engines whose init() is running. Touched on the creation path only.
  const initializing = new Set<GwenEngine>();

  function get(engine: GwenEngine): T {
    const real = unwrapEngine(engine);
    const existing = map.get(real);
    if (existing) return existing.value;
    return create(real);
  }

  function create(real: GwenEngine): T {
    if (
      typeof (real as { disposables?: { add?: unknown } } | null)?.disposables?.add !== "function"
    ) {
      throw new GwenError(
        CoreErrorCodes.INVALID_ENGINE,
        `Expected a GWEN engine, received ${describeNonEngine(real)}.`,
        {
          composable: "createEngineLocal().get",
          hint: __GWEN_DEV__
            ? "Pass the engine from useEngine(), plugin setup() or createEngine()."
            : undefined,
        },
      );
    }
    if (real.disposables.closed) {
      throw new GwenError(
        CoreErrorCodes.ENGINE_DISPOSED,
        "Cannot create a per-engine value after engine.stop().",
        {
          composable: "createEngineLocal().get",
          hint: __GWEN_DEV__ ? "Read it with peek(), or create a new engine." : undefined,
        },
      );
    }
    if (initializing.has(real)) {
      throw new GwenError(
        CoreErrorCodes.ENGINE_LOCAL_REENTRANT,
        "init() called get() for the engine it is creating a value for.",
        {
          composable: "createEngineLocal().get",
          hint: __GWEN_DEV__
            ? "Do not read the same engine-local inside its own init(); pass the value in, or read it later."
            : undefined,
        },
      );
    }
    initializing.add(real);
    let value: T;
    try {
      value = init(real);
    } finally {
      initializing.delete(real);
    }
    // Register before storing: a failed add leaves no entry behind.
    real.disposables.add(
      "engine-local",
      createDisposable(() => {
        const current = map.get(real);
        if (!current) return;
        try {
          dispose?.(current.value, real);
        } finally {
          map.delete(real);
        }
      }),
    );
    map.set(real, { value });
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

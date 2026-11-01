/**
 * Glue instances for a compiled module.
 * `shared` keeps one instance per module. `isolated` keeps one instance per engine.
 * `auto` keeps the first engine on that pool, then isolated instances under a budget.
 * Providers map `initSync` only. `createGlue` and `new Engine` are not mapped.
 */

import { GwenError } from "@gwenjs/schema";

import { CoreErrorCodes, toSentence } from "./engine-errors.js";
import type { GwenCoreGlueFactoryModule, GwenCoreGlueInstance } from "./wasm-bridge-types.js";

export type WasmInstanceMode = "shared" | "isolated" | "auto";

export interface AutoFallback {
  reason: "capacity" | "budget";
  isolatedLive: number;
  cause?: unknown;
}

interface WasmInstanceAcquire {
  glue: GwenCoreGlueInstance;
  exports: { memory: WebAssembly.Memory };
  placement: "shared" | "isolated";
  fallback?: AutoFallback;
}

export interface WasmInstanceProvider {
  readonly mode: WasmInstanceMode;
  acquire(module: WebAssembly.Module, factory: GwenCoreGlueFactoryModule): WasmInstanceAcquire;
  release(glue: GwenCoreGlueInstance): void;
}

interface SharedEntry {
  glue: GwenCoreGlueInstance;
  exports: { memory: WebAssembly.Memory };
  refs: number;
  poisoned: WebAssembly.RuntimeError | null;
  bridges: Set<WeakHandle<SharedBridgePoison>>;
  module: WebAssembly.Module;
}

const byModule = new WeakMap<WebAssembly.Module, SharedEntry>();
const byGlue = new Map<GwenCoreGlueInstance, SharedEntry>();

/** One per live shared instance. Decremented once, when that entry's refs hit zero. */
let sharedLive = 0;

const CAPACITY_HINT = 'Use wasmInstance: "shared", fewer engines per process, or worker threads.';

/**
 * Map one `glue.initSync` failure.
 * A `RangeError`, or a throw that is not an `Error`, is `CORE:WASM_CAPACITY_EXHAUSTED`.
 * `LinkError` and `CompileError` are `CORE:WASM_LOAD_ERROR`.
 * Anything else is rethrown as the same object.
 */
function mapInstantiateError(err: unknown, mode: WasmInstanceMode, live: number): never {
  if (err instanceof RangeError || !(err instanceof Error)) {
    throw new GwenError(
      CoreErrorCodes.WASM_CAPACITY_EXHAUSTED,
      `Cannot create another WASM instance (mode "${mode}", ${live} live).`,
      {
        composable: "initWasm",
        cause: err,
        hint: __GWEN_DEV__ ? CAPACITY_HINT : undefined,
      },
    );
  }
  if (err instanceof WebAssembly.LinkError || err instanceof WebAssembly.CompileError) {
    throw new GwenError(CoreErrorCodes.WASM_LOAD_ERROR, toSentence(err.message), {
      composable: "initWasm",
      cause: err,
    });
  }
  throw err;
}

/** `initSync` only. Callers count a success after this returns. */
function instantiate(
  glue: GwenCoreGlueInstance,
  module: WebAssembly.Module,
  mode: WasmInstanceMode,
  live: number,
): { memory: WebAssembly.Memory } {
  try {
    return glue.initSync({ module });
  } catch (err: unknown) {
    mapInstantiateError(err, mode, live);
  }
}

/**
 * One glue and one memory per compiled Module, for the whole process.
 * Stored after `initSync`. A trap drops the module cache. Zero refs drops the count.
 */
export const sharedProvider: WasmInstanceProvider = {
  mode: "shared",
  acquire(module, factory) {
    const hit = byModule.get(module);
    if (hit !== undefined) {
      hit.refs += 1;
      return { glue: hit.glue, exports: hit.exports, placement: "shared" };
    }
    const glue = factory.createGlue();
    const exports = instantiate(glue, module, "shared", sharedLive);
    const entry: SharedEntry = {
      glue,
      exports,
      refs: 1,
      poisoned: null,
      bridges: new Set(),
      module,
    };
    byModule.set(module, entry);
    byGlue.set(glue, entry);
    sharedLive += 1;
    return { glue, exports, placement: "shared" };
  },
  release(glue) {
    const entry = byGlue.get(glue);
    if (entry === undefined) return;
    entry.refs -= 1;
    if (entry.refs > 0) return;
    if (byModule.get(entry.module) === entry) byModule.delete(entry.module);
    byGlue.delete(glue);
    sharedLive -= 1;
  },
};

/** Successful isolated acquires that have not been released. */
let isolatedLive = 0;

/**
 * Glues still acquired.
 * Membership only. A second acquire of the same glue does not count twice.
 * Release drops the member. The set does not pin the instance.
 */
const liveGlues = new WeakSet<GwenCoreGlueInstance>();

/**
 * One glue and one memory per acquire.
 * A failed `initSync` does not change the live count.
 */
export const isolatedProvider: WasmInstanceProvider = {
  mode: "isolated",
  acquire(module, factory) {
    const glue = factory.createGlue();
    const exports = instantiate(glue, module, "isolated", isolatedLive);
    if (liveGlues.has(glue)) return { glue, exports, placement: "isolated" };
    isolatedLive += 1;
    liveGlues.add(glue);
    return { glue, exports, placement: "isolated" };
  },
  release(glue) {
    if (!liveGlues.has(glue)) return;
    liveGlues.delete(glue);
    isolatedLive -= 1;
  },
};

/** Isolated engines after the pool engine, when `wasmIsolatedBudget` is omitted. */
const AUTO_ISOLATED_BUDGET = 16;

let loggedCapacity = false;
let loggedBudget = false;

/** True the first time this realm logs `reason`. */
export function claimAutoFallback(reason: "capacity" | "budget"): boolean {
  const already = reason === "capacity" ? loggedCapacity : loggedBudget;
  if (already) return false;
  if (reason === "capacity") loggedCapacity = true;
  else loggedBudget = true;
  return true;
}

/** Clears the once-per-reason log flags. Does not touch instances or live counts. */
export function resetAutoFallbackLog(): void {
  loggedCapacity = false;
  loggedBudget = false;
}

function autoCapacityError(cause: unknown): GwenError {
  return new GwenError(
    CoreErrorCodes.WASM_CAPACITY_EXHAUSTED,
    `Cannot create another WASM instance (mode "auto", ${sharedLive} live).`,
    {
      composable: "initWasm",
      cause,
      hint: __GWEN_DEV__ ? CAPACITY_HINT : undefined,
    },
  );
}

function readCause(err: object): unknown {
  return "cause" in err ? err.cause : undefined;
}

function rethrowForAutoPool(err: unknown): never {
  if (err instanceof GwenError && err.code === CoreErrorCodes.WASM_LOAD_ERROR) throw err;
  if (err instanceof GwenError && err.code === CoreErrorCodes.WASM_CAPACITY_EXHAUSTED) {
    throw autoCapacityError(readCause(err));
  }
  throw err;
}

function capacityCauseOf(err: unknown): { readonly cause: unknown } | undefined {
  if (!(err instanceof GwenError) || err.code !== CoreErrorCodes.WASM_CAPACITY_EXHAUSTED) {
    return undefined;
  }
  return { cause: readCause(err) };
}

function budgetFull(isolatedBudget: number): boolean {
  return isolatedLive >= isolatedBudget;
}

function withFallback(
  pooled: WasmInstanceAcquire,
  reason: "capacity" | "budget",
  cause?: unknown,
): WasmInstanceAcquire {
  const fallback: AutoFallback = { reason, isolatedLive };
  if (cause !== undefined) fallback.cause = cause;
  return { glue: pooled.glue, exports: pooled.exports, placement: "shared", fallback };
}

/** First `auto` engine of a module is the pool. Later ones are isolated under `budget`. */
export function autoProvider(budget?: number): WasmInstanceProvider {
  const isolatedBudget = budget ?? AUTO_ISOLATED_BUDGET;
  return {
    mode: "auto",
    acquire(module, factory) {
      const creating = byModule.get(module) === undefined;
      let pooled: WasmInstanceAcquire;
      try {
        pooled = sharedProvider.acquire(module, factory);
      } catch (err: unknown) {
        rethrowForAutoPool(err);
      }
      if (creating) return pooled;
      if (budgetFull(isolatedBudget)) return withFallback(pooled, "budget");
      try {
        const isolated = isolatedProvider.acquire(module, factory);
        sharedProvider.release(pooled.glue);
        return isolated;
      } catch (err: unknown) {
        const capacity = capacityCauseOf(err);
        if (capacity !== undefined) return withFallback(pooled, "capacity", capacity.cause);
        sharedProvider.release(pooled.glue);
        throw err;
      }
    },
    release(glue) {
      if (byGlue.has(glue)) {
        sharedProvider.release(glue);
        return;
      }
      isolatedProvider.release(glue);
    },
  };
}

/** `deref` is `undefined` once the target is collected. */
export interface WeakHandle<T extends object> {
  deref(): T | undefined;
}

interface WeakHandleConstructor {
  new <T extends object>(target: T): WeakHandle<T>;
}

function isWeakHandleConstructor(value: unknown): value is WeakHandleConstructor {
  return typeof value === "function";
}

/**
 * Build a weak handle for `target` from the host `WeakRef`.
 * `deref` is `undefined` after the target is collected, and the entry skips it.
 * When the host has no `WeakRef`, `deref` returns `target` for the life of the handle.
 * The shared entry then keeps the bridge alive, so a collected bridge is not skipped.
 */
export function weakHandle<T extends object>(target: T): WeakHandle<T> {
  const ctor: unknown = Reflect.get(globalThis, "WeakRef");
  if (isWeakHandleConstructor(ctor)) {
    return new ctor(target);
  }
  return {
    deref(): T | undefined {
      return target;
    },
  };
}

/** Callback a shared entry holds by a weak handle. The bridge poisons itself and does not call back. */
export type SharedBridgePoison = (
  cause: WebAssembly.RuntimeError,
  exportName: string | undefined,
) => void;

/**
 * Record a weak handle on the entry that owns `glue`.
 * A missing entry does nothing. The bridge unregisters the same handle before release.
 */
export function registerSharedBridge(
  glue: GwenCoreGlueInstance,
  poison: WeakHandle<SharedBridgePoison>,
): void {
  const entry = byGlue.get(glue);
  if (entry === undefined) return;
  entry.bridges.add(poison);
}

/** Drop one weak handle from its entry. A missing entry does nothing. */
export function unregisterSharedBridge(
  glue: GwenCoreGlueInstance,
  poison: WeakHandle<SharedBridgePoison>,
): void {
  const entry = byGlue.get(glue);
  if (entry === undefined) return;
  entry.bridges.delete(poison);
}

/**
 * Poison every bridge on `glue`'s entry except `origin`, and drop the module cache.
 * The origin is already poisoned. A second call keeps the first cause.
 * A bridge poisoned here must not call this again.
 * A cleared handle is skipped. `cause` is the trap, not a bridge.
 */
export function poisonInstance(
  glue: GwenCoreGlueInstance,
  cause: WebAssembly.RuntimeError,
  exportName: string | undefined,
  origin: SharedBridgePoison,
): void {
  const entry = byGlue.get(glue);
  if (entry === undefined || entry.poisoned !== null) return;
  entry.poisoned = cause;
  byModule.delete(entry.module);
  for (const ref of entry.bridges) {
    const bridge = ref.deref();
    if (bridge === undefined || bridge === origin) continue;
    bridge(cause, exportName);
  }
}

/**
 * Glue instances for a compiled module.
 * `shared` keeps one instance per module. `isolated` keeps one instance per engine.
 * Both providers map `initSync` only. `createGlue` and `new Engine` are not mapped.
 */

import { GwenError } from "@gwenjs/schema";

import { CoreErrorCodes, toSentence } from "./engine-errors.js";
import type { GwenCoreGlueFactoryModule, GwenCoreGlueInstance } from "./wasm-bridge-types.js";

export type WasmInstanceMode = "shared" | "isolated";

export interface WasmInstanceProvider {
  readonly mode: WasmInstanceMode;
  acquire(
    module: WebAssembly.Module,
    factory: GwenCoreGlueFactoryModule,
  ): { glue: GwenCoreGlueInstance; exports: { memory: WebAssembly.Memory } };
  release(glue: GwenCoreGlueInstance): void;
}

interface SharedEntry {
  glue: GwenCoreGlueInstance;
  exports: { memory: WebAssembly.Memory };
  refs: number;
}

const byModule = new WeakMap<WebAssembly.Module, SharedEntry>();
const byGlue = new Map<GwenCoreGlueInstance, WebAssembly.Module>();

/**
 * Cached shared modules.
 * One per successful insert. This matches `byGlue.size` when each module has its own glue.
 */
let sharedLive = 0;

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
        hint: __GWEN_DEV__
          ? 'Use wasmInstance: "shared", fewer engines per process, or worker threads.'
          : undefined,
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
 * The entry is stored only after `initSync` succeeds, and removed at zero refs.
 */
export const sharedProvider: WasmInstanceProvider = {
  mode: "shared",
  acquire(module, factory) {
    const hit = byModule.get(module);
    if (hit !== undefined) {
      hit.refs += 1;
      return { glue: hit.glue, exports: hit.exports };
    }
    const glue = factory.createGlue();
    const exports = instantiate(glue, module, "shared", sharedLive);
    const entry: SharedEntry = { glue, exports, refs: 1 };
    byModule.set(module, entry);
    byGlue.set(glue, module);
    sharedLive += 1;
    return { glue, exports };
  },
  release(glue) {
    const module = byGlue.get(glue);
    if (module === undefined) return;
    const entry = byModule.get(module);
    if (entry === undefined) return;
    entry.refs -= 1;
    if (entry.refs > 0) return;
    byModule.delete(module);
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
    if (liveGlues.has(glue)) return { glue, exports };
    isolatedLive += 1;
    liveGlues.add(glue);
    return { glue, exports };
  },
  release(glue) {
    if (!liveGlues.has(glue)) return;
    liveGlues.delete(glue);
    isolatedLive -= 1;
  },
};

import { WasmBridgeImpl } from "./wasm-bridge";
import { validateEngineConfig } from "./engine-config-validator";
import type { GwenEngine, GwenEngineOptions } from "./engine-types.js";
import type { InitWasmOptions } from "./wasm-bridge-types.js";
import { GwenEngineImpl } from "./gwen-engine.js";
import { claimAutoFallback } from "./wasm-instance-provider";

function engineFieldsOf(opts: GwenEngineOptions & InitWasmOptions): GwenEngineOptions {
  const {
    glue: _glue,
    jsUrl: _jsUrl,
    wasmUrl: _wasmUrl,
    wasmBytes: _wasmBytes,
    wasmModule: _wasmModule,
    wasmInstance: _wasmInstance,
    wasmIsolatedBudget: _wasmIsolatedBudget,
    ...engine
  } = opts;
  return engine;
}

function warnAutoFallback(engine: GwenEngine, bridge: WasmBridgeImpl | undefined): GwenEngine {
  if (!(bridge instanceof WasmBridgeImpl)) return engine;
  const fallback = bridge.pullAutoFallback();
  if (fallback === undefined) return engine;
  if (!claimAutoFallback(fallback.reason)) return engine;
  const payload: Record<string, unknown> = {
    reason: fallback.reason,
    mode: "auto",
    isolatedLive: fallback.isolatedLive,
  };
  if (fallback.cause !== undefined) payload.cause = fallback.cause;
  engine.logger.warn('wasmInstance "auto" joined the pool.', payload);
  return engine;
}

/**
 * Create a GWEN engine instance.
 *
 * @param options - Engine configuration. All fields optional.
 *   Init fields are not stored on the engine. Omitted `wasmInstance` stays `"shared"` (#267).
 *   `"auto"` is opt-in. A pool fallback is logged once the engine exists.
 *   In Node, import from `@gwenjs/core/node`.
 * @returns The engine. When `options._bridge` is omitted, the light bridge is loaded first.
 * The engine owns that bridge, so `stop()` disposes it. A caller that passes `_bridge`
 * calls `bridge.dispose()` after `stop()`.
 *
 * @example
 * ```typescript
 * import { createEngine } from '@gwenjs/core'
 * const engine = await createEngine({ maxEntities: 5_000, variant: 'physics2d' })
 * await engine.use(myPlugin())
 * ```
 */
export async function createEngine(
  options?: GwenEngineOptions & InitWasmOptions,
): Promise<GwenEngine> {
  validateEngineConfig(options ?? {});
  const opts = options ?? {};
  if (opts._bridge !== undefined) {
    return warnAutoFallback(new GwenEngineImpl(engineFieldsOf(opts)), opts._bridge);
  }
  const bridge = new WasmBridgeImpl();
  const variant = opts.variant ?? "light";
  await bridge.init(variant, opts);
  return warnAutoFallback(
    new GwenEngineImpl(engineFieldsOf({ ...opts, _bridge: bridge, _ownsBridge: true })),
    bridge,
  );
}

/**
 * Initialises the WASM core and creates a new engine in a single call.
 *
 * Equivalent to:
 * ```ts
 * const bridge = new WasmBridgeImpl();
 * await bridge.init(options?.variant ?? 'light', options);
 * const engine = await createEngine({ ...options, _bridge: bridge, _ownsBridge: true });
 * ```
 *
 * Use this in application entry points. In tests or environments where WASM
 * must be mocked, call {@link createEngine} directly and pass a pre-configured
 * `WasmBridgeImpl` via the `_bridge` option (e.g. `createEngine({ _bridge: myBridge })`).
 *
 * @param options - Engine configuration. The init fields (`glue`, `jsUrl`, `wasmUrl`, `wasmBytes`, `wasmModule`, `wasmInstance`, `wasmIsolatedBudget`) and `variant`/`maxEntities` are forwarded to `bridge.init`; the init fields are not stored on the engine.
 * @returns A fully initialised {@link GwenEngine} with WASM ready.
 *
 * @example
 * ```ts
 * import { setupGwen } from '@gwenjs/core'
 *
 * const engine = await setupGwen({ variant: 'physics2d', maxEntities: 5_000 })
 * await engine.start()
 * ```
 */
export async function setupGwen(
  options?: GwenEngineOptions & InitWasmOptions,
): Promise<GwenEngine> {
  validateEngineConfig(options ?? {});
  const bridge = new WasmBridgeImpl();
  await bridge.init(options?.variant ?? "light", options);
  return createEngine({ ...options, _bridge: bridge, _ownsBridge: true });
}

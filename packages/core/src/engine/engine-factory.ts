import { WasmBridgeImpl } from "./wasm-bridge";
import { validateEngineConfig } from "./engine-config-validator";
import type { GwenEngine, GwenEngineOptions } from "./engine-types.js";
import type { CoreVariant, InitWasmOptions } from "./wasm-bridge-types.js";
import { GwenEngineImpl } from "./gwen-engine.js";

interface NodeFs {
  existsSync(path: string): boolean;
  readFileSync(path: string): { toString(encoding: "base64"): string };
}

interface NodePath {
  dirname(path: string): string;
  join(...parts: string[]): string;
}

interface NodeUrl {
  fileURLToPath(url: string): string;
  pathToFileURL(path: string): { href: string };
}

// A variable specifier keeps this file free of `@types/node`. Renderer test
// programs typecheck the source through the `@gwenjs/*` path and do not load
// the Node types.
async function loadNode<T>(specifier: string): Promise<T> {
  return import(specifier) as Promise<T>;
}

function nodeHost(): boolean {
  const version = (globalThis as { process?: { versions?: { node?: string } } }).process?.versions
    ?.node;
  return typeof version === "string";
}

async function nodeWasmUrls(variant: CoreVariant): Promise<{ jsUrl?: string; wasmUrl?: string }> {
  if (!nodeHost()) return {};
  const fs = await loadNode<NodeFs>("node:fs");
  const { fileURLToPath, pathToFileURL } = await loadNode<NodeUrl>("node:url");
  const path = await loadNode<NodePath>("node:path");
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = ["../../wasm", "../wasm", "../../../wasm"].map((relative) =>
    path.join(here, relative, variant),
  );
  const root = candidates.find((dir) => fs.existsSync(path.join(dir, "gwen_core_factory.js")));
  if (root === undefined) return {};
  const wasmBytes = fs.readFileSync(path.join(root, "gwen_core_bg.wasm"));
  return {
    jsUrl: pathToFileURL(path.join(root, "gwen_core_factory.js")).href,
    wasmUrl: `data:application/wasm;base64,${wasmBytes.toString("base64")}`,
  };
}

// `glue` is the factory. Node still supplies the package binary, and does not add `jsUrl`.
// `wasmBytes` or `wasmModule` skips that package `wasmUrl`. Without `glue`, Node still adds `jsUrl`.
function nodeInitOptions(
  opts: GwenEngineOptions & InitWasmOptions,
  urls: { jsUrl?: string; wasmUrl?: string },
): InitWasmOptions {
  if (opts.wasmBytes !== undefined || opts.wasmModule !== undefined) {
    if (opts.glue !== undefined || urls.jsUrl === undefined) return opts;
    return { ...opts, jsUrl: urls.jsUrl };
  }
  if (opts.glue === undefined) return { ...opts, ...urls };
  const wasmUrl = opts.wasmUrl ?? urls.wasmUrl;
  if (wasmUrl === undefined) return opts;
  return { ...opts, wasmUrl };
}

function engineFieldsOf(opts: GwenEngineOptions & InitWasmOptions): GwenEngineOptions {
  const {
    glue: _glue,
    jsUrl: _jsUrl,
    wasmUrl: _wasmUrl,
    wasmBytes: _wasmBytes,
    wasmModule: _wasmModule,
    wasmInstance: _wasmInstance,
    ...engine
  } = opts;
  return engine;
}

/**
 * Create a GWEN engine instance.
 *
 * @param options - Engine configuration. All fields optional.
 *   In Node, when the package `wasm/` directory is found and `glue` is omitted, its URLs replace `jsUrl` and `wasmUrl`; when `glue` is set, only the package `wasmUrl` is added, and a caller `wasmUrl` wins.
 *   `wasmBytes` or `wasmModule` skips that package `wasmUrl`. Without `glue`, Node still adds `jsUrl`.
 *   Init fields are not stored on the engine. Omitted `wasmInstance` stays `"shared"` (#267).
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
  if (opts._bridge !== undefined) return new GwenEngineImpl(engineFieldsOf(opts));
  const bridge = new WasmBridgeImpl();
  const variant = opts.variant ?? "light";
  const urls = await nodeWasmUrls(variant);
  await bridge.init(variant, nodeInitOptions(opts, urls));
  return new GwenEngineImpl(engineFieldsOf({ ...opts, _bridge: bridge, _ownsBridge: true }));
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
 * @param options - Engine configuration. The init fields (`glue`, `jsUrl`, `wasmUrl`, `wasmBytes`, `wasmModule`, `wasmInstance`) and `variant`/`maxEntities` are forwarded to `bridge.init`; the init fields are not stored on the engine.
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
  const bridge = new WasmBridgeImpl();
  await bridge.init(options?.variant ?? "light", options);
  return createEngine({ ...options, _bridge: bridge, _ownsBridge: true });
}

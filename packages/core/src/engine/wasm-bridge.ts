/**
 * WASM Bridge — Interface between @gwenjs/core (TypeScript) and gwen_core.wasm (Rust).
 *
 * The Rust/WASM core is MANDATORY — no TypeScript fallback exists.
 * Call `await initWasm()` BEFORE creating the Engine, or an error is thrown.
 *
 * ⚠️  INTENTIONAL CO-LOCATION — Do not split the implementation.
 * V8 inlines calls between functions in the same compilation unit.
 * A previous refactor attempt that split this file caused a measurable perf
 * regression on the hot path (entity queries + component reads at ~1000 entities/frame).
 * Keep all bridge implementation code co-located so the JIT can inline across
 * method boundaries. Type-only definitions (interfaces, type aliases) have been
 * extracted to wasm-bridge-types.ts since they are erased at compile time
 * and have no impact on V8 inlining.
 *
 * NAVIGATION (use IDE region folding — Ctrl+Shift+[ / Cmd+Shift+[):
 *   wasm-bridge-types.ts                        — variant type contracts (WasmEngine*)
 *   #region Module loading & initialization     — variant detection, fetch, instantiation
 *   #region WasmBridge implementation           — hot path: entity/component/query calls
 *   #region Current-engine bridge               — getWasmBridge()
 *
 * @example
 * ```typescript
 * const bridge = new WasmBridgeImpl()
 * await bridge.init()
 * const engine = await createEngine({ _bridge: bridge })
 * await engine.start()
 * ```
 */

import { createEntityId, unpackEntityId, type EntityId } from "./engine-api";
import { GwenError } from "@gwenjs/schema";
import {
  CoreErrorCodes,
  GwenWasmError,
  GwenWasmPanicError,
  isCoreWasmErrorCode,
} from "./engine-errors";
import { engineContext, GwenContextError } from "./context";

// ─── Re-exports from extracted type module ──────────────────────────────────
// All public types were in this file before extraction. Re-export them so
// existing `import { ... } from './wasm-bridge.js'` statements keep working.

export type {
  CoreVariant,
  WasmEntityId,
  GwenCoreWasm,
  WasmEngineBase,
  WasmEnginePhysics2D,
  WasmEnginePhysics3D,
  WasmEngine,
  InitWasmOptions,
  WasmBridge,
} from "./wasm-bridge-types.js";

// ─── Imports from extracted module (used by implementation below) ───────────

import type {
  CoreVariant,
  WasmEntityId,
  GwenCoreWasm,
  WasmEngineBase,
  WasmEnginePhysics2D,
  WasmEnginePhysics3D,
  WasmEngine,
  InitWasmOptions,
  WasmBridge,
} from "./wasm-bridge-types.js";

// #region Module loading & initialization ─────────────────────────────────────

/**
 * Base URL for WASM artifacts (auto-resolved in browser, null in Node).
 *
 * Resolution strategy (in order):
 *  1. In browser: /wasm/ relative to current origin.
 *     @gwenjs/vite serves this via middleware (dev)
 *     and CLI copies it to dist/wasm/ (build).
 *  2. In Node (SSR/tests): null — initWasm() must receive explicit URL.
 *
 * We avoid new URL('../wasm/', import.meta.url) because in Vite dev mode
 * it produces an @fs/.../.../engine-core/wasm path without trailing slash,
 * resulting in an invalid URL.
 */
const _pkgWasmBase: string | null = (() => {
  // `location` is available in both browser main thread and Web Workers (self.location).
  // We no longer check `typeof window` so this also works in worker contexts.
  if (typeof location !== "undefined") {
    // Browser / Worker — artifacts always served from /wasm/ by Vite plugin
    return `${location.origin}/wasm/`;
  }
  return null;
})();

// InitWasmOptions — extracted to ./wasm-bridge-types.ts

// ── Internal types for DOM-based glue loading ─────────────────────────────────

/**
 * Extended `Window` interface that allows dynamic property access.
 * Used to cache loaded WASM glue modules on the global object.
 */
interface GwenWindow extends Window {
  [key: string]: unknown;
}

// eslint-disable-next-line no-unused-vars
declare const window: GwenWindow;

/**
 * Shape of a wasm-bindgen generated ES glue module.
 * The exact exports depend on the wasm-bindgen version and init mode.
 */
interface WasmGlueModule {
  /** Async init — returns raw WASM instance exports including the linear memory. */
  default?: (init: {
    module_or_path?: Response | undefined;
  }) => Promise<{ memory?: WebAssembly.Memory }>;
  /** Sync init — returns raw WASM instance exports including the linear memory. */
  initSync?: (init: { module: ArrayBuffer }) => { memory?: WebAssembly.Memory };
  Engine?: new (maxEntities: number) => WasmEngine;
  [key: string]: unknown;
}

/**
 * Load a WASM ES glue module, with two code paths:
 *
 * - **Main thread** (DOM available): injects a `<script type="module">` into the document
 *   to work around Vite's restriction on dynamic `import()` for `/public` assets.
 * - **Web Worker** (no DOM): falls back to a dynamic `import()` which is natively
 *   supported in module workers (`new Worker(url, { type: 'module' })`).
 *
 * The loaded module is cached on `globalThis` under a deterministic key so repeated
 * calls for the same URL are free (no extra network round-trips).
 *
 * @param jsUrl Absolute or root-relative URL to the wasm-bindgen JS glue file.
 */
async function loadWasmGlue(jsUrl: string): Promise<WasmGlueModule> {
  const key = `__gwenGlue_${jsUrl.replace(/\W/g, "_")}`;
  const ctx = globalThis as Record<string, unknown>;

  // Cache hit — same URL already loaded in this context.
  if (ctx[key]) return ctx[key] as WasmGlueModule;

  // Resolve to an absolute URL. `globalThis.location` is available in both
  // the main thread (window.location) and module workers (self.location).
  const base = (globalThis as { location?: { href: string } }).location?.href ?? jsUrl;
  const absoluteUrl = new URL(jsUrl, base).href;

  // ── Worker path: no DOM, use dynamic import() ─────────────────────────────
  if (typeof document === "undefined") {
    const glue = (await import(/* @vite-ignore */ absoluteUrl)) as WasmGlueModule;
    ctx[key] = glue;
    return glue;
  }

  // ── Main thread path: script injection (preserves Vite /public compat) ────
  return new Promise<WasmGlueModule>((resolve, reject) => {
    const blob = new Blob(
      [
        `import * as glue from '${absoluteUrl}';`,
        `globalThis['${key}'] = glue;`,
        `globalThis['${key}__resolve']?.();`,
      ],
      { type: "text/javascript" },
    );

    const blobUrl = URL.createObjectURL(blob);

    ctx[`${key}__resolve`] = () => {
      // Delete the resolver reference so it doesn't linger on globalThis.
      delete ctx[`${key}__resolve`];
      URL.revokeObjectURL(blobUrl);
      script.remove();
      resolve(ctx[key] as WasmGlueModule);
    };

    const script = document.createElement("script");
    script.type = "module";
    script.src = blobUrl;
    script.onerror = (e) => {
      // Delete the resolver reference that was set before the script ran.
      delete ctx[`${key}__resolve`];
      URL.revokeObjectURL(blobUrl);
      script.remove();
      reject(
        new GwenError(
          CoreErrorCodes.WASM_LOAD_ERROR,
          `[GWEN] Unable to load WASM glue: ${jsUrl}\n${e}`,
        ),
      );
    };

    document.head.appendChild(script);
  });
}

// #endregion

// WasmBridge interface — extracted to ./wasm-bridge-types.ts

// #region WasmBridge implementation (hot path — do not split) ─────────────────

/**
 * Map a core export failure onto a typed error.
 * Internal: not on {@link WasmBridge} and not a method of {@link WasmBridgeImpl}.
 * `poison` marks the calling bridge after a core trap.
 */
export function toGwenWasmError(
  err: unknown,
  exportName: string,
  poison: (cause: WebAssembly.RuntimeError) => void,
): unknown {
  if (err instanceof WebAssembly.RuntimeError) {
    poison(err);
    return new GwenWasmPanicError(exportName, err);
  }
  if (err instanceof Error) {
    const code = (err as Error & { code?: unknown }).code;
    if (isCoreWasmErrorCode(code)) {
      return new GwenWasmError(code, err.message, exportName, err);
    }
  }
  return err;
}

const bridgePoisoners = new WeakMap<object, (cause: WebAssembly.RuntimeError) => void>();

/**
 * Mark a core bridge poisoned after a trap that never passed through
 * {@link toGwenWasmError}. Frame loop only. Not a public bridge method.
 */
export function poisonWasmBridge(bridge: object, cause: WebAssembly.RuntimeError): void {
  bridgePoisoners.get(bridge)?.(cause);
}

/**
 * Concrete implementation of `WasmBridge`.
 *
 * Every public method delegates to the `_wasmEngine` instance via
 * `_requireWasm()`, which throws a clear error if WASM is not yet loaded.
 * All type conversions (e.g. `number[] → Uint32Array`, packed EntityId
 * reconstruction) happen here so callers never touch raw Rust types.
 *
 * All WASM state is stored as instance fields — multiple independent bridge
 * instances are fully isolated from each other.
 *
 * @internal — Obtain via `getWasmBridge()` or `new WasmBridgeImpl()`.
 */
export class WasmBridgeImpl implements WasmBridge {
  // ── Per-instance state (was module-level) ─────────────────────────────────
  private _wasmEngine: WasmEngine | null = null;
  /** Ids for test mocks that do not export `register_component_type`. */
  private _localTypeId = 0;
  private _wasmModule: GwenCoreWasm | null = null;
  private _wasmExports: { memory?: WebAssembly.Memory } | null = null;
  private _initPromise: Promise<void> | null = null;
  private _maxEntities = 10_000;
  private _activeVariant: CoreVariant = "light";
  /** Set after a core trap. Later calls throw without entering WASM. */
  private _poisoned = false;
  private _panicCause: WebAssembly.RuntimeError | null = null;

  /** Track the last seen ArrayBuffer to detect memory.grow() events. */
  private _lastMemoryBuffer: ArrayBuffer | null = null;

  /** View over this engine's query result buffer. Recreated when memory, pointer, or capacity changes. */
  private _queryResultView: Uint32Array | null = null;

  /** Dynamic buffer for type IDs to avoid allocations on every query. */
  private _typeIdBuffer = new Uint32Array(16);

  constructor() {
    bridgePoisoners.set(this, (cause) => {
      this._poison(cause);
    });
  }

  /**
   * Get or create a subarray view of the type ID buffer.
   * Grows the buffer to the next power of 2 if needed.
   *
   * @param n The number of type IDs needed
   * @returns A Uint32Array view of size n over the internal buffer
   * @internal
   */
  private _getTypeIdView(n: number): Uint32Array {
    if (n > this._typeIdBuffer.length) {
      // Grow to next power of 2 above n
      const newSize = Math.pow(2, Math.ceil(Math.log2(n)));
      this._typeIdBuffer = new Uint32Array(newSize);
    }
    return this._typeIdBuffer.subarray(0, n);
  }

  // ── Query buffers (zero-alloc query optimization) ──────────────────────────

  /** Reused buffer for bulk query slots. Sized to `maxEntities`. */
  private _querySlotsBuf?: Uint32Array | undefined;
  /** Reused buffer for bulk query generations. Sized to `maxEntities`. */
  private _queryGensBuf?: Uint32Array | undefined;
  /** Reused buffer for bulk component data. */
  private _queryDataBuf?: Uint8Array | undefined;

  /** @internal */
  _resetQueryBuffers(): void {
    this._querySlotsBuf = undefined;
    this._queryGensBuf = undefined;
    this._queryDataBuf = undefined;
  }

  // ── Init ─────────────────────────────────────────────────────────────────

  /**
   * Load and initialize the gwen_core WASM module for this bridge instance.
   *
   * @param variant The core variant to load ('light', 'physics2d', 'physics3d')
   * @param options Initialization options (urls, max entities)
   * @throws {GwenError} If WASM cannot be loaded or has invalid format
   */
  async init(variant: CoreVariant = "light", options: InitWasmOptions = {}): Promise<void> {
    if (this._wasmEngine) return;
    if (this._initPromise) return this._initPromise;
    this._poisoned = false;
    this._panicCause = null;

    const { maxEntities = 10_000, jsUrl, wasmUrl } = options;

    this._maxEntities = maxEntities;
    this._activeVariant = variant;

    const variantPath = `${variant}/`;
    const resolvedJsUrl =
      jsUrl ?? (_pkgWasmBase ? `${_pkgWasmBase}${variantPath}gwen_core.js` : null);
    const resolvedWasmUrl =
      wasmUrl ?? (_pkgWasmBase ? `${_pkgWasmBase}${variantPath}gwen_core_bg.wasm` : null);

    if (!resolvedJsUrl) {
      throw new GwenError(
        CoreErrorCodes.WASM_LOAD_ERROR,
        `[GWEN] bridge.init(): unable to resolve WASM URL for variant "${variant}".\n` +
          "Make sure @gwenjs/core is correctly installed.",
      );
    }

    this._initPromise = (async () => {
      const glue = await loadWasmGlue(resolvedJsUrl);

      const _fetchController = new AbortController();
      const _fetchTimeoutId = setTimeout(() => _fetchController.abort(), 10_000);

      let wasmInput: Response | undefined;
      try {
        if (resolvedWasmUrl) {
          wasmInput = await fetch(resolvedWasmUrl, { signal: _fetchController.signal });
          if (!wasmInput.ok) {
            throw new GwenError(
              CoreErrorCodes.WASM_LOAD_ERROR,
              `[GWEN] WASM fetch failed with HTTP ${wasmInput.status} ${wasmInput.statusText}`,
            );
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          throw new GwenError(
            CoreErrorCodes.WASM_TIMEOUT,
            `[CORE:WASM_TIMEOUT] bridge.init() timed out after 10s waiting for WASM binary.`,
          );
        }
        throw err;
      } finally {
        clearTimeout(_fetchTimeoutId);
      }

      if (typeof glue.default === "function") {
        // glue.default() returns the raw WASM instance exports (including memory)
        this._wasmExports = await glue.default({ module_or_path: wasmInput });
      } else if (typeof glue.initSync === "function") {
        const buf = await (await fetch(resolvedWasmUrl!)).arrayBuffer();
        this._wasmExports = glue.initSync({ module: buf });
      } else {
        throw new GwenError(
          CoreErrorCodes.WASM_LOAD_ERROR,
          "[GWEN] WASM glue has no init() function — corrupted file?",
        );
      }

      if (typeof glue.Engine !== "function") {
        throw new GwenError(
          CoreErrorCodes.WASM_LOAD_ERROR,
          "[GWEN] WASM glue loaded but Engine class not found.",
        );
      }

      this._wasmModule = glue as GwenCoreWasm;
      try {
        this._wasmEngine = new glue.Engine(maxEntities);
      } catch (err: unknown) {
        throw this._mapWasmError(err, "new");
      }
      this._captureMemoryBaseline();

      if (__GWEN_DEV__) {
        const label =
          variant === "physics2d" ? "Physics2D" : variant === "physics3d" ? "Physics3D" : "Light";
        // eslint-disable-next-line no-console
        console.log(`[GWEN] WASM core loaded — ${label} variant active`);
      }
    })().catch((err: unknown) => {
      this._initPromise = null;
      this._wasmEngine = null;
      this._wasmModule = null;
      this._wasmExports = null;
      if (err instanceof GwenError) {
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new GwenError(
        CoreErrorCodes.WASM_LOAD_ERROR,
        message,
        err instanceof Error ? { cause: err } : undefined,
      );
    });

    return this._initPromise;
  }

  // ── Internal guard ────────────────────────────────────────────────────────

  /**
   * Guard that returns the active WasmEngine or throws a descriptive error.
   * All bridge methods call this so the error message is consistent and actionable.
   *
   * @throws {GwenError} If `init()` has not been called yet.
   * @internal
   */
  private _requireWasm(): WasmEngine {
    if (this._poisoned && this._panicCause) {
      throw new GwenWasmPanicError(undefined, this._panicCause);
    }
    if (!this._wasmEngine) {
      throw new GwenError(
        CoreErrorCodes.WASM_NOT_INITIALIZED,
        "[GWEN] WASM core not initialized.\n" +
          "Call `await bridge.init()` or `setupGwen()` before starting the Engine.",
      );
    }
    return this._wasmEngine;
  }

  private _poison(cause: WebAssembly.RuntimeError): void {
    this._poisoned = true;
    this._panicCause = cause;
  }

  private _mapWasmError(err: unknown, exportName: string): unknown {
    return toGwenWasmError(err, exportName, (cause) => {
      this._poison(cause);
    });
  }

  // ── Test utilities ────────────────────────────────────────────────────────

  /** @internal — test only */
  _injectMock(mock: WasmEngine, maxEntities?: number): void {
    this._wasmEngine = mock;
    this._initPromise = Promise.resolve();
    if (maxEntities !== undefined) this._maxEntities = maxEntities;
  }

  /** @internal — test only */
  _injectMockExports(exports: { memory?: WebAssembly.Memory }): void {
    this._wasmExports = exports;
  }

  /** @internal — test only */
  _reset(): void {
    this._wasmEngine = null;
    this._wasmModule = null;
    this._wasmExports = null;
    this._initPromise = null;
    this._poisoned = false;
    this._panicCause = null;
    this._lastMemoryBuffer = null;
    this._queryResultView = null;
    this._maxEntities = 10_000;
    this._resetQueryBuffers();
  }

  // ── Status ───────────────────────────────────────────────────────────────

  isActive(): boolean {
    return this._wasmEngine !== null;
  }

  get variant(): CoreVariant {
    return this._activeVariant;
  }

  hasPhysics(): boolean {
    return this._activeVariant === "physics2d" || this._activeVariant === "physics3d";
  }

  getPhysicsBridge(): WasmEnginePhysics2D | WasmEnginePhysics3D {
    if (!this.hasPhysics()) {
      throw new GwenError(
        CoreErrorCodes.WASM_VARIANT_MISMATCH,
        `[GWEN] getPhysicsBridge(): physics is not available in variant "${this._activeVariant}". ` +
          'Use "physics2d" or "physics3d" variant instead.',
      );
    }
    return this._requireWasm() as WasmEnginePhysics2D | WasmEnginePhysics3D;
  }

  engine(): WasmEngine {
    return this._requireWasm();
  }

  // ── Entity ───────────────────────────────────────────────────────────────

  /**
   * Create a new entity and return its packed handle (index + generation).
   *
   * @throws {GwenWasmError} code `CORE:ENTITY_LIMIT_REACHED` when `maxEntities` is reached.
   *   The bridge stays usable after that throw.
   */
  createEntity(): WasmEntityId {
    const wasm = this._requireWasm();
    try {
      return wasm.create_entity();
    } catch (error: unknown) {
      throw this._mapWasmError(error, "create_entity");
    }
  }

  /**
   * Create N entities, each with a transform.
   *
   * @throws {GwenWasmError} code `CORE:ENTITY_LIMIT_REACHED` when N exceeds the remaining
   *   capacity. No entity is created in that case. The bridge stays usable.
   */
  bulkSpawnWithTransforms(positions: Float32Array, rotations: Float32Array): Uint32Array {
    const wasm = this._requireWasm();
    try {
      return wasm.bulk_spawn_with_transforms(positions, rotations);
    } catch (error: unknown) {
      throw this._mapWasmError(error, "bulk_spawn_with_transforms");
    }
  }

  /**
   * Re-parent through the fallible export. Checks poison before entering WASM.
   * @internal
   */
  setEntityParent(childIndex: number, parentIndex: number, keepWorldPos: boolean): void {
    const wasm = this._requireWasm();
    try {
      wasm.set_entity_parent(childIndex, parentIndex, keepWorldPos);
    } catch (error: unknown) {
      throw this._mapWasmError(error, "set_entity_parent");
    }
  }

  deleteEntity(index: number, generation: number): boolean {
    return this._requireWasm().delete_entity(index, generation);
  }

  isAlive(index: number, generation: number): boolean {
    return this._requireWasm().is_alive(index, generation);
  }

  countEntities(): number {
    return this._requireWasm().count_entities();
  }

  // ── Component ────────────────────────────────────────────────────────────

  registerComponentType(): number {
    const wasm = this._requireWasm();
    if (typeof wasm.register_component_type !== "function") {
      this._localTypeId += 1;
      return this._localTypeId;
    }
    return wasm.register_component_type();
  }

  addComponent(index: number, generation: number, typeId: number, data: Uint8Array): boolean {
    const wasm = this._requireWasm();
    try {
      return wasm.add_component(index, generation, typeId, data);
    } catch (error: unknown) {
      throw this._mapWasmError(error, "add_component");
    }
  }

  removeComponent(index: number, generation: number, typeId: number): boolean {
    return this._requireWasm().remove_component(index, generation, typeId);
  }

  hasComponent(index: number, generation: number, typeId: number): boolean {
    return this._requireWasm().has_component(index, generation, typeId);
  }

  getComponentRaw(index: number, generation: number, typeId: number): Uint8Array {
    return this._requireWasm().get_component_raw(index, generation, typeId);
  }

  readComponentsBulk(
    entities: EntityId[],
    componentTypeId: number,
    componentSize: number,
  ): Float32Array {
    const n = entities.length;
    if (n === 0) return new Float32Array(0);

    // Build flat Uint32Array pairs for slots/gens (two separate arrays for Rust).
    const slots = new Uint32Array(n);
    const gens = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      const { index, generation } = unpackEntityId(entities[i]!);
      slots[i] = index;
      gens[i] = generation;
    }

    // Pre-allocate the output buffer (pre-zeroed by the JS runtime).
    const outBuf = new Uint8Array(n * componentSize);
    this._requireWasm().get_components_bulk(slots, gens, componentTypeId, outBuf);

    // Return a Float32Array view over the same buffer — no copy.
    return new Float32Array(outBuf.buffer, outBuf.byteOffset, outBuf.byteLength / 4);
  }

  writeComponentsBulk(entities: EntityId[], componentTypeId: number, data: Float32Array): void {
    const n = entities.length;
    if (n === 0) return;

    const slots = new Uint32Array(n);
    const gens = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      const { index, generation } = unpackEntityId(entities[i]!);
      slots[i] = index;
      gens[i] = generation;
    }

    // Pass data as a Uint8Array view over the Float32Array buffer — no copy.
    const dataBytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const wasm = this._requireWasm();
    try {
      wasm.set_components_bulk(slots, gens, componentTypeId, dataBytes);
    } catch (error: unknown) {
      throw this._mapWasmError(error, "set_components_bulk");
    }
  }

  /**
   * Query entities with ALL given component types and bulk-read one component
   * type. One WASM call when the result fits in the slots buffer.
   *
   * Reuses buffers across frames to minimize GC pressure.
   * Memory is lazily allocated and grown only if the component stride increases.
   *
   * Slots and generations are sized to `maxEntities`. When `entityCount` fills
   * that buffer, the uncapped `query_entities` list is checked. A longer list
   * throws `GwenError` (`CORE:QUERY_CAPACITY_EXCEEDED`).
   *
   * Dead entities or stale generation pairs are skipped by the Rust side.
   *
   * @param componentTypeIds - Component type IDs every matching entity must have
   * @param readTypeId       - Which component type to read into the returned buffer
   * @param f32Stride        - Float32 values per entity
   * @returns `{ entityCount, data, slots, gens }` where `data` is a zero-copy
   *   `Float32Array` view, and `slots`/`gens` are `Uint32Array` views for
   *   passing back to `queryWriteBulk`.
   *
   * @performance One WASM crossing when the result fits. A full buffer checks
   *   the uncapped query once more.
   * ~350× faster than N individual `getComponentRaw` calls for 1 000 entities.
   *
   * @throws If `initWasm()` has not been called.
   * @throws {GwenError} `CORE:QUERY_CAPACITY_EXCEEDED` when more entities match
   *   than the slots buffer can hold.
   */
  queryReadBulk(
    componentTypeIds: number[],
    readTypeId: number,
    f32Stride: number,
  ): { entityCount: number; data: Float32Array; slots: Uint32Array; gens: Uint32Array } {
    const maxEntities = this._maxEntities;
    const byteStride = f32Stride * 4;

    // Lazily allocate reused views — kept across frames to avoid GC pressure.
    if (!this._querySlotsBuf) {
      this._querySlotsBuf = new Uint32Array(maxEntities);
      this._queryGensBuf = new Uint32Array(maxEntities);
      this._queryDataBuf = new Uint8Array(maxEntities * byteStride);
    } else if ((this._queryDataBuf?.length ?? 0) < maxEntities * byteStride) {
      // Re-allocate if stride increased (different component on same bridge).
      this._queryDataBuf = new Uint8Array(maxEntities * byteStride);
    }

    const slotsBuf = this._querySlotsBuf;
    const gensBuf = this._queryGensBuf;
    const dataBuf = this._queryDataBuf;
    if (slotsBuf === undefined || gensBuf === undefined || dataBuf === undefined) {
      throw new GwenError(
        CoreErrorCodes.SHARED_BUFFER_ALLOC_FAILED,
        "[GWEN] query buffers were not allocated.",
      );
    }

    const typeIds = new Uint32Array(componentTypeIds);
    const result = this._requireWasm().query_read_bulk(
      typeIds,
      readTypeId,
      slotsBuf,
      gensBuf,
      dataBuf,
    );

    // result is a Uint32Array [entityCount, bytesWritten]
    const entityCount = result[0] ?? 0;

    // A full buffer may be an exact fit or a truncation. The uncapped query
    // decides. Skip it when the buffer still has room.
    if (entityCount === slotsBuf.length) {
      const full = this._requireWasm().query_entities(typeIds);
      if (full.length > entityCount) {
        throw new GwenError(
          CoreErrorCodes.QUERY_CAPACITY_EXCEEDED,
          "[GWEN] queryReadBulk exceeded the buffer capacity.",
        );
      }
    }

    return {
      entityCount,
      data: new Float32Array(dataBuf.buffer, 0, entityCount * f32Stride),
      slots: slotsBuf.subarray(0, entityCount),
      gens: gensBuf.subarray(0, entityCount),
    };
  }

  /**
   * Write back component data for a previously-queried entity set in one WASM call.
   *
   * Pass the `slots` and `gens` from a prior `queryReadBulk` result.
   * Dead entities (stale generation) are silently skipped on the Rust side.
   *
   * @param slots       - Entity slot indices (from `queryReadBulk` result)
   * @param gens        - Entity generation counters (from `queryReadBulk` result)
   * @param writeTypeId - Component type ID to write
   * @param data        - Updated packed Float32 data (`entityCount × f32Stride` elements)
   *
   * @performance One WASM boundary crossing for any number of entities.
   *
   * @throws If `initWasm()` has not been called.
   * @throws {GwenWasmError} code `CORE:BUFFER_LENGTH_MISMATCH` when `gens`
   *   differs in length from `slots`, or when `data` is not
   *   `slots.length × stride` bytes. The message names the buffer, the
   *   expected length, and the actual length. Nothing is written.
   */
  queryWriteBulk(
    slots: Uint32Array,
    gens: Uint32Array,
    writeTypeId: number,
    data: Float32Array,
  ): void {
    const dataBytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const wasm = this._requireWasm();
    try {
      wasm.query_write_bulk(slots, gens, writeTypeId, dataBytes);
    } catch (error: unknown) {
      throw this._mapWasmError(error, "query_write_bulk");
    }
  }

  // ── Query ────────────────────────────────────────────────────────────────

  updateEntityArchetype(index: number, typeIds: number[]): void {
    this._requireWasm().update_entity_archetype(index, new Uint32Array(typeIds));
  }

  removeEntityFromQuery(index: number): void {
    this._requireWasm().remove_entity_from_query(index);
  }

  /**
   * Query entities matching the given component type IDs.
   *
   * Returns EntityIds (branded bigint) using 64-bit packing:
   * - 32-bit generation counter (supports unlimited recyclings)
   * - 32-bit index (supports up to 4 billion entities)
   *
   * @param typeIds - Component type IDs to match
   * @returns Array of EntityIds for matching entities
   */
  queryEntities(typeIds: number[]): EntityId[] {
    const indices = Array.from(this._requireWasm().query_entities(new Uint32Array(typeIds)));
    return indices.map((idx) => {
      const gen = this._requireWasm().get_entity_generation(idx);
      return createEntityId(idx, gen);
    });
  }

  queryEntitiesRaw(typeIds: number[]): number {
    const count = typeIds.length;
    // Copy type IDs into the dynamic buffer
    for (let i = 0; i < count; i++) {
      this._typeIdBuffer[i] = typeIds[i] ?? 0;
    }
    // Get a view sized to the actual count, growing the buffer if needed
    const view = this._getTypeIdView(count);
    const wasm = this._requireWasm();
    try {
      return wasm.query_entities_to_buffer(view);
    } catch (error: unknown) {
      throw this._mapWasmError(error, "query_entities_to_buffer");
    }
  }

  forEachQueryResultRaw(typeIds: number[], callback: (entityIndex: number) => void): void {
    const count = this.queryEntitiesRaw(typeIds);
    const view = this._getQueryResultView();
    for (let i = 0; i < count; i++) {
      callback(view[i] ?? 0);
    }
  }

  /**
   * View over this engine's query result buffer.
   * Length is `get_query_result_capacity()`, not `maxEntities`.
   * Recreated when WASM memory grows, or when the pointer or the capacity changes.
   * @internal
   */
  private _getQueryResultView(): Uint32Array {
    const mem = this._wasmExports?.memory;
    if (!mem) {
      throw new GwenError(
        CoreErrorCodes.WASM_NOT_INITIALIZED,
        "[GWEN] Cannot access WASM memory (not initialized or mock).",
      );
    }

    const wasm = this._requireWasm();
    const ptr = wasm.get_query_result_ptr();
    const capacity = wasm.get_query_result_capacity();
    const view = this._queryResultView;
    if (
      view === null ||
      view.buffer !== mem.buffer ||
      view.byteOffset !== ptr ||
      view.length !== capacity
    ) {
      const next = new Uint32Array(mem.buffer, ptr, capacity);
      this._queryResultView = next;
      return next;
    }
    return view;
  }

  getEntityGeneration(index: number): number {
    return this._requireWasm().get_entity_generation(index);
  }

  // ── Game loop ────────────────────────────────────────────────────────────

  tick(deltaMs: number): void {
    this._requireWasm().tick(deltaMs);
  }

  // ── Shared memory ────────────────────────────────────────────────────────

  allocSharedBuffer(byteLength: number): number {
    const ptr = this._requireWasm().alloc_shared_buffer(byteLength);
    if (ptr === 0) {
      throw new GwenError(
        CoreErrorCodes.SHARED_BUFFER_ALLOC_FAILED,
        `[GwenBridge] alloc_shared_buffer failed: requested ${byteLength} bytes. ` +
          `This is either an OOM condition or a zero-size request.`,
      );
    }
    return ptr;
  }

  freeSharedBuffer(ptr: number, byteLength: number): void {
    this._requireWasm().free_shared_buffer(ptr, byteLength);
  }

  syncTransformsToBuffer(ptr: number, maxEntities: number): void {
    const wasm = this._requireWasm();
    try {
      wasm.sync_transforms_to_buffer(ptr, maxEntities);
    } catch (error: unknown) {
      throw this._mapWasmError(error, "sync_transforms_to_buffer");
    }
  }

  syncTransformsToBufferSparse(ptr: number): void {
    this._requireWasm().sync_transforms_to_buffer_sparse(ptr);
  }

  dirtyTransformCount(): number {
    return this._requireWasm().dirty_transform_count();
  }

  clearTransformDirty(): void {
    this._requireWasm().clear_transform_dirty();
  }

  syncTransformsFromBuffer(ptr: number, maxEntities: number): void {
    const wasm = this._requireWasm();
    try {
      wasm.sync_transforms_from_buffer(ptr, maxEntities);
    } catch (error: unknown) {
      throw this._mapWasmError(error, "sync_transforms_from_buffer");
    }
  }

  // ── Linear memory ────────────────────────────────────────────────────────

  /**
   * Return the live `WebAssembly.Memory` exported by gwen_core.wasm.
   *
   * wasm-bindgen exposes it as `glueModule.memory`. We cache the module
   * reference in `_wasmModule` at init time, so this is a single property
   * read — no cost on the hot path.
   *
   * Returns `null` when the WASM module is not yet loaded or when running
   * in a test environment that injects a mock without a real memory export.
   */
  getLinearMemory(): WebAssembly.Memory | null {
    return this._wasmExports?.memory ?? null;
  }

  /**
   * Record `memory.buffer` at the end of `init`.
   * The mock-injection path does not call this: the first `checkMemoryGrow()` still records.
   * @internal
   */
  _captureMemoryBaseline(): void {
    const mem = this._wasmExports?.memory;
    if (mem) this._lastMemoryBuffer = mem.buffer;
  }

  /**
   * Detect whether `memory.grow()` has been called since the last check.
   *
   * When Rust allocates enough memory to exhaust the current WASM linear memory,
   * the runtime calls `memory.grow(n_pages)`. This **replaces** the underlying
   * `ArrayBuffer`. We detect this by comparing the reference to the current
   * buffer against the one stored during the previous check.
   *
   * **Idempotent** : Calling this twice without a grow returns `false` on the
   * second call (the state was already updated by the first call).
   *
   * **Cost** : O(1) — single pointer comparison.
   *
   * @returns `true` if memory has grown since last check, `false` otherwise.
   *
   * @internal
   */
  checkMemoryGrow(): boolean {
    const mem = this._wasmExports?.memory;
    if (!mem) return false;

    const currentBuffer = mem.buffer;

    // First call: initialize state
    if (this._lastMemoryBuffer === null) {
      this._lastMemoryBuffer = currentBuffer;
      return false;
    }

    // Grow detected: buffer reference changed
    if (this._lastMemoryBuffer !== currentBuffer) {
      this._lastMemoryBuffer = currentBuffer;
      return true;
    }

    // No grow since last check
    return false;
  }

  // ── Stats ────────────────────────────────────────────────────────────────

  stats(): string {
    return this._requireWasm().stats();
  }
}

// #endregion

// #region Current-engine bridge ───────────────────────────────────────────────

/**
 * Return the `WasmBridge` provided by the current engine.
 *
 * There is no module-level fallback. Outside an engine, or when the engine
 * has no `wasm:bridge` service, this throws `GwenContextError` `CORE:OUTSIDE_ENGINE_CONTEXT`.
 */
export function getWasmBridge(): WasmBridge {
  const engine = engineContext.tryUse();
  const bridge = engine?.tryInject("wasm:bridge");
  if (!engine || !bridge) {
    throw new GwenContextError(
      "[GWEN] getWasmBridge() was called outside an active engine context.",
      CoreErrorCodes.OUTSIDE_ENGINE_CONTEXT,
    );
  }
  return bridge;
}

// #endregion

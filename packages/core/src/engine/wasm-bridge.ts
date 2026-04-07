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
 *   #region Internal state & hot-path buffers   — module-level singletons, zero-alloc views
 *   #region Module loading & initialization     — variant detection, fetch, instantiation
 *   #region WasmBridge implementation           — hot path: entity/component/query calls
 *   #region Singleton management & test utils   — getWasmBridge(), _inject*, _reset*
 *
 * @example
 * ```typescript
 * await initWasm();          // Auto-resolves from @gwenjs/core/wasm/
 * const engine = getEngine();
 * engine.start();
 * ```
 */

import { createEntityId, unpackEntityId, type EntityId } from './engine-api';

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
} from './wasm-bridge-types.js';

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
} from './wasm-bridge-types.js';

// #region Internal state & hot-path static buffers ───────────────────────────

let _wasmEngine: WasmEngine | null = null;
let _wasmModule: GwenCoreWasm | null = null;
let _wasmExports: { memory?: WebAssembly.Memory } | null = null; // raw WASM instance exports
let _initPromise: Promise<void> | null = null;
let _maxEntities = 10_000;
let _activeVariant: CoreVariant = 'light';

/** Track the last seen ArrayBuffer to detect memory.grow() events. */
let _lastMemoryBuffer: ArrayBuffer | null = null;

/** Static view for zero-alloc query results. Recreated on memory.grow(). */
let _queryResultView: Uint32Array | null = null;

/** Static buffer for type IDs to avoid allocations on every query. */
const _typeIdBuffer = new Uint32Array(16);
/** Pre-allocated views for common type ID counts (0-16). */
const _typeIdViews = Array.from({ length: 17 }, (_, i) => _typeIdBuffer.subarray(0, i));

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
  if (typeof location !== 'undefined') {
    // Browser / Worker — artifacts always served from /wasm/ by Vite plugin
    return `${location.origin}/wasm/`;
  }
  return null;
})();

// #endregion

// #region Module loading & initialization ─────────────────────────────────────

// InitWasmOptions — extracted to ./wasm-bridge-types.ts

/**
 * Load and initialize the gwen_core WASM module. **REQUIRED** before any Engine usage.
 *
 * **Without arguments**: Auto-resolves from `@gwenjs/core/wasm/light/`
 * (pre-compiled artifacts published in the package — no Rust build needed).
 *
 * @param variant The core variant to load ('light', 'physics2d', 'physics3d')
 * @param options Initialization options (urls, max entities, SAB requirement)
 * @throws {Error} If WASM cannot be loaded or has invalid format
 */
export async function initWasm(
  variant: CoreVariant = 'light',
  options: InitWasmOptions = {},
): Promise<void> {
  if (_wasmEngine) return;
  if (_initPromise) return _initPromise;

  const { maxEntities = 10_000, requireSAB = false, jsUrl, wasmUrl } = options;

  // ── P0: Validate SharedArrayBuffer availability ────────────────────────────
  if (requireSAB && typeof SharedArrayBuffer === 'undefined') {
    throw new Error(
      '[GWEN] SharedArrayBuffer is required by a WASM plugin but not available.\n' +
        'Your server MUST send COOP/COEP headers to enable SharedArrayBuffer.\n' +
        'See: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer',
    );
  }

  _maxEntities = maxEntities;
  _activeVariant = variant;

  const variantPath = `${variant}/`;
  const resolvedJsUrl =
    jsUrl ?? (_pkgWasmBase ? `${_pkgWasmBase}${variantPath}gwen_core.js` : null);
  const resolvedWasmUrl =
    wasmUrl ?? (_pkgWasmBase ? `${_pkgWasmBase}${variantPath}gwen_core_bg.wasm` : null);

  if (!resolvedJsUrl) {
    throw new Error(
      `[GWEN] initWasm(): unable to resolve WASM glue URL for variant "${variant}".\n` +
        'Make sure @gwenjs/core is correctly installed.',
    );
  }

  _initPromise = (async () => {
    const glue = await loadWasmGlue(resolvedJsUrl);

    const _fetchController = new AbortController();
    const _fetchTimeoutId = setTimeout(() => _fetchController.abort(), 10_000);

    let wasmInput: Response | undefined;
    try {
      if (resolvedWasmUrl) {
        wasmInput = await fetch(resolvedWasmUrl, { signal: _fetchController.signal });
        if (!wasmInput.ok) {
          throw new Error(
            `[GWEN] WASM fetch failed with HTTP ${wasmInput.status} ${wasmInput.statusText}`,
          );
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(
          `[CORE:WASM_TIMEOUT] initWasm() timed out after 10s waiting for WASM binary.`,
        );
      }
      throw err;
    } finally {
      clearTimeout(_fetchTimeoutId);
    }

    if (typeof glue.default === 'function') {
      // glue.default() returns the raw WASM instance exports (including memory)
      _wasmExports = await glue.default({ module_or_path: wasmInput });
    } else if (typeof glue.initSync === 'function') {
      const buf = await (await fetch(resolvedWasmUrl!)).arrayBuffer();
      _wasmExports = glue.initSync({ module: buf });
    } else {
      throw new Error('[GWEN] WASM glue has no init() function — corrupted file?');
    }

    if (typeof glue.Engine !== 'function') {
      throw new Error('[GWEN] WASM glue loaded but Engine class not found.');
    }

    _wasmModule = glue as GwenCoreWasm;
    _wasmEngine = new glue.Engine(maxEntities);

    if (variant === 'physics2d') {
      if (import.meta.env?.DEV) {
        console.log('[GWEN] WASM core loaded — Physics2D variant active');
      }
    } else if (variant === 'physics3d') {
      if (import.meta.env?.DEV) {
        console.log('[GWEN] WASM core loaded — Physics3D variant active');
      }
    } else {
      if (import.meta.env?.DEV) {
        console.log('[GWEN] WASM core loaded — Light variant active');
      }
    }
  })().catch((err) => {
    _initPromise = null;
    _wasmEngine = null;
    _wasmModule = null;
    _wasmExports = null;
    const tagged = err instanceof Error ? err : new Error(String(err));
    (tagged as Error & { code?: string }).code = 'CORE:WASM_LOAD_ERROR';
    throw tagged;
  });

  return _initPromise;
}

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
  const key = `__gwenGlue_${jsUrl.replace(/\W/g, '_')}`;
  const ctx = globalThis as Record<string, unknown>;

  // Cache hit — same URL already loaded in this context.
  if (ctx[key]) return ctx[key] as WasmGlueModule;

  // Resolve to an absolute URL. `globalThis.location` is available in both
  // the main thread (window.location) and module workers (self.location).
  const base = (globalThis as { location?: { href: string } }).location?.href ?? jsUrl;
  const absoluteUrl = new URL(jsUrl, base).href;

  // ── Worker path: no DOM, use dynamic import() ─────────────────────────────
  if (typeof document === 'undefined') {
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
      { type: 'text/javascript' },
    );

    const blobUrl = URL.createObjectURL(blob);

    ctx[`${key}__resolve`] = () => {
      URL.revokeObjectURL(blobUrl);
      script.remove();
      resolve(ctx[key] as WasmGlueModule);
    };

    const script = document.createElement('script');
    script.type = 'module';
    script.src = blobUrl;
    script.onerror = (e) => {
      URL.revokeObjectURL(blobUrl);
      script.remove();
      reject(new Error(`[GWEN] Unable to load WASM glue: ${jsUrl}\n${e}`));
    };

    document.head.appendChild(script);
  });
}

// #endregion

// WasmBridge interface — extracted to ./wasm-bridge-types.ts


// #region WasmBridge implementation (hot path — do not split) ─────────────────

/**
 * Guard that returns the active WasmEngine or throws a descriptive error.
 * All bridge methods call this so the error message is consistent and actionable.
 *
 * @throws {Error} If `initWasm()` has not been called yet.
 * @internal
 */
function requireWasm(): WasmEngine {
  if (!_wasmEngine) {
    throw new Error(
      '[GWEN] WASM core not initialized.\n' + 'Call `await initWasm()` before starting the Engine.',
    );
  }
  return _wasmEngine;
}

/**
 * Concrete implementation of `WasmBridge`.
 *
 * Every public method delegates to the `_wasmEngine` singleton via
 * `requireWasm()`, which throws a clear error if WASM is not yet loaded.
 * All type conversions (e.g. `number[] → Uint32Array`, packed EntityId
 * reconstruction) happen here so callers never touch raw Rust types.
 *
 * @internal — Obtain the singleton via `getWasmBridge()`.
 */
class WasmBridgeImpl implements WasmBridge {
  // ── Private static buffers (zero-alloc query bulk optimization) ──────────

  /** Reusable static buffer for query results (entity slots). */
  private _bulkSlots?: Uint32Array;
  /** Reusable static buffer for query results (entity generations). */
  private _bulkGens?: Uint32Array;
  /** Reusable static buffer for bulk component data. */
  private _bulkBuf?: Uint8Array;

  // ── Status ───────────────────────────────────────────────────────────────

  isActive(): boolean {
    return _wasmEngine !== null;
  }

  get variant(): CoreVariant {
    return _activeVariant;
  }

  hasPhysics(): boolean {
    return _activeVariant === 'physics2d' || _activeVariant === 'physics3d';
  }

  getPhysicsBridge(): WasmEnginePhysics2D | WasmEnginePhysics3D {
    if (!this.hasPhysics()) {
      throw new Error(
        `[GWEN] getPhysicsBridge(): physics is not available in variant "${_activeVariant}". ` +
          'Use "physics2d" or "physics3d" variant instead.',
      );
    }
    return requireWasm() as WasmEnginePhysics2D | WasmEnginePhysics3D;
  }

  engine(): WasmEngine {
    return requireWasm();
  }

  // ── Entity ───────────────────────────────────────────────────────────────

  createEntity(): WasmEntityId {
    return requireWasm().create_entity();
  }

  deleteEntity(index: number, generation: number): boolean {
    return requireWasm().delete_entity(index, generation);
  }

  isAlive(index: number, generation: number): boolean {
    return requireWasm().is_alive(index, generation);
  }

  countEntities(): number {
    return requireWasm().count_entities();
  }

  // ── Component ────────────────────────────────────────────────────────────

  registerComponentType(): number {
    return requireWasm().register_component_type();
  }

  addComponent(index: number, generation: number, typeId: number, data: Uint8Array): boolean {
    return requireWasm().add_component(index, generation, typeId, data);
  }

  removeComponent(index: number, generation: number, typeId: number): boolean {
    return requireWasm().remove_component(index, generation, typeId);
  }

  hasComponent(index: number, generation: number, typeId: number): boolean {
    return requireWasm().has_component(index, generation, typeId);
  }

  getComponentRaw(index: number, generation: number, typeId: number): Uint8Array {
    return requireWasm().get_component_raw(index, generation, typeId);
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
    requireWasm().get_components_bulk(slots, gens, componentTypeId, outBuf);

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
    requireWasm().set_components_bulk(slots, gens, componentTypeId, dataBytes);
  }

  /**
   * Query entities with ALL given component types and bulk-read one component
   * type in a **single WASM call** (no per-entity crossings).
   *
   * Internally allocates static buffers (reused across frames) to minimize GC pressure.
   * Memory is lazily allocated and grown only if needed.
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
   * @performance Crosses the WASM boundary **once** regardless of entity count.
   * ~350× faster than N individual `getComponentRaw` calls for 1 000 entities.
   *
   * @throws If `initWasm()` has not been called.
   *
   * @since 1.0.0
   */
  queryReadBulk(
    componentTypeIds: number[],
    readTypeId: number,
    f32Stride: number,
  ): { entityCount: number; data: Float32Array; slots: Uint32Array; gens: Uint32Array } {
    const maxEntities = 10_000;
    const byteStride = f32Stride * 4;

    // Lazily allocate static views — reused every frame to avoid GC pressure.
    if (!this._bulkSlots) {
      this._bulkSlots = new Uint32Array(maxEntities);
      this._bulkGens = new Uint32Array(maxEntities);
      this._bulkBuf = new Uint8Array(maxEntities * byteStride);
    } else if ((this._bulkBuf?.length ?? 0) < maxEntities * byteStride) {
      // Re-allocate if stride increased (different component on same bridge).
      this._bulkBuf = new Uint8Array(maxEntities * byteStride);
    }

    const result = requireWasm().query_read_bulk(
      new Uint32Array(componentTypeIds),
      readTypeId,
      this._bulkSlots,
      this._bulkGens!,
      this._bulkBuf!,
    );

    // result is a Uint32Array [entityCount, bytesWritten]
    const entityCount = result[0] ?? 0;

    return {
      entityCount,
      data: new Float32Array(this._bulkBuf!.buffer, 0, entityCount * f32Stride),
      slots: this._bulkSlots.subarray(0, entityCount),
      gens: this._bulkGens!.subarray(0, entityCount),
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
   *
   * @since 1.0.0
   */
  queryWriteBulk(
    slots: Uint32Array,
    gens: Uint32Array,
    writeTypeId: number,
    data: Float32Array,
  ): void {
    const dataBytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    requireWasm().query_write_bulk(slots, gens, writeTypeId, dataBytes);
  }

  // ── Query ────────────────────────────────────────────────────────────────

  updateEntityArchetype(index: number, typeIds: number[]): void {
    requireWasm().update_entity_archetype(index, new Uint32Array(typeIds));
  }

  removeEntityFromQuery(index: number): void {
    requireWasm().remove_entity_from_query(index);
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
    const indices = Array.from(requireWasm().query_entities(new Uint32Array(typeIds)));
    return indices.map((idx) => {
      const gen = requireWasm().get_entity_generation(idx);
      return createEntityId(idx, gen);
    });
  }

  queryEntitiesRaw(typeIds: number[]): number {
    const count = typeIds.length;
    // Fast path for common component counts (0-16) using zero-alloc views
    if (count <= 16) {
      for (let i = 0; i < count; i++) {
        _typeIdBuffer[i] = typeIds[i] ?? 0;
      }
      const fastView = _typeIdViews[count];
      return requireWasm().query_entities_to_buffer(fastView ?? new Uint32Array(typeIds));
    }
    // Fallback for very complex queries (rare in game engines)
    return requireWasm().query_entities_to_buffer(new Uint32Array(typeIds));
  }

  forEachQueryResultRaw(typeIds: number[], callback: (entityIndex: number) => void): void {
    const count = this.queryEntitiesRaw(typeIds);
    const view = this._getQueryResultView();
    for (let i = 0; i < count; i++) {
      callback(view[i] ?? 0);
    }
  }

  /**
   * Helper to get or refresh the static query result view.
   * Recreates the view if WASM memory has grown.
   * @internal
   */
  private _getQueryResultView(): Uint32Array {
    const mem = _wasmExports?.memory;
    if (!mem) {
      throw new Error('[GWEN] Cannot access WASM memory (not initialized or mock).');
    }

    if (!_queryResultView || _queryResultView.buffer !== mem.buffer) {
      _queryResultView = new Uint32Array(mem.buffer, requireWasm().get_query_result_ptr(), 10_000);
    }
    return _queryResultView;
  }

  getEntityGeneration(index: number): number {
    return requireWasm().get_entity_generation(index);
  }

  // ── Game loop ────────────────────────────────────────────────────────────

  tick(deltaMs: number): void {
    requireWasm().tick(deltaMs);
  }

  // ── Shared memory ────────────────────────────────────────────────────────

  allocSharedBuffer(byteLength: number): number {
    const ptr = requireWasm().alloc_shared_buffer(byteLength);
    if (ptr === 0) {
      throw new Error(
        `[GwenBridge] alloc_shared_buffer failed: requested ${byteLength} bytes. ` +
          `This is either an OOM condition or a zero-size request.`,
      );
    }
    return ptr;
  }

  syncTransformsToBuffer(ptr: number, maxEntities: number): void {
    requireWasm().sync_transforms_to_buffer(ptr, maxEntities);
  }

  syncTransformsToBufferSparse(ptr: number): void {
    requireWasm().sync_transforms_to_buffer_sparse(ptr);
  }

  dirtyTransformCount(): number {
    return requireWasm().dirty_transform_count();
  }

  clearTransformDirty(): void {
    requireWasm().clear_transform_dirty();
  }

  syncTransformsFromBuffer(ptr: number, maxEntities: number): void {
    requireWasm().sync_transforms_from_buffer(ptr, maxEntities);
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
    return _wasmExports?.memory ?? null;
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
    const mem = _wasmExports?.memory;
    if (!mem) return false;

    const currentBuffer = mem.buffer;

    // First call: initialize state
    if (_lastMemoryBuffer === null) {
      _lastMemoryBuffer = currentBuffer;
      return false;
    }

    // Grow detected: buffer reference changed
    if (_lastMemoryBuffer !== currentBuffer) {
      _lastMemoryBuffer = currentBuffer;
      return true;
    }

    // No grow since last check
    return false;
  }

  // ── Stats ────────────────────────────────────────────────────────────────

  stats(): string {
    return requireWasm().stats();
  }
}

// #endregion

// #region Singleton management & test utilities ────────────────────────────────

const _bridge = new WasmBridgeImpl();

/**
 * Return the `WasmBridge` singleton.
 *
 * The bridge is always available — it is created eagerly at module load time.
 * Methods will throw if `initWasm()` has not been called yet.
 *
 * @example
 * ```typescript
 * await initWasm();
 * const bridge = getWasmBridge();
 * bridge.isActive(); // true
 * ```
 */
export function getWasmBridge(): WasmBridge {
  return _bridge;
}

/**
 * Inject a mock `WasmEngine` — **reserved for unit tests only**.
 *
 * Allows the `Engine` to be tested without a real browser or `.wasm` binary.
 * `getLinearMemory()` returns `null` in this mode because `_wasmModule` is
 * left `null` intentionally — sentinel checks and debug views are silently
 * skipped, which is the correct behaviour in a Node.js test environment.
 *
 * @param mock - A `WasmEngine` mock (typically built with `vi.fn()`).
 */
export function _injectMockWasmEngine(mock: WasmEngine): void {
  _wasmEngine = mock;
  _initPromise = Promise.resolve();
}

/**
 * Inject mock WASM exports — **reserved for unit tests only**.
 *
 * Allows testing `checkMemoryGrow()` by injecting a fake memory object
 * that can be manipulated to simulate a grow event.
 *
 * @param exports - A mock exports object with optional `memory` property.
 *
 * @example
 * ```typescript
 * const buf1 = new ArrayBuffer(100);
 * const buf2 = new ArrayBuffer(200);
 * const mockMemory = { buffer: buf1 } as unknown as { memory?: WebAssembly.Memory };
 * _injectMockWasmExports({ memory: mockMemory });
 *
 * const bridge = getWasmBridge();
 * bridge.checkMemoryGrow(); // init
 * mockMemory.buffer = buf2; // simulate grow
 * expect(bridge.checkMemoryGrow()).toBe(true);
 * ```
 *
 * @internal
 */
export function _injectMockWasmExports(exports: { memory?: WebAssembly.Memory }): void {
  _wasmExports = exports;
}

/**
 * Fully reset the bridge state — **reserved for unit tests only**.
 *
 * Clears `_wasmEngine`, `_wasmExports`, `_initPromise`, and `_lastMemoryBuffer`
 * so that the next `initWasm()` call starts from a clean slate.
 * Call this in `afterEach` to prevent state leaking between tests.
 */
export function _resetWasmBridge(): void {
  _wasmEngine = null;
  _wasmExports = null;
  _initPromise = null;
  _lastMemoryBuffer = null;
  _queryResultView = null;
}

// #endregion

import { GwenError, type GwenErrorPayload, type GwenErrorTarget } from "@gwenjs/schema";
import { buildTransformImports } from "../hooks/wasm/transform-imports.js";
import { SharedMemoryManager, TRANSFORM_STRIDE } from "../hooks/wasm/shared-memory.js";
import { DisposableRegistry, createDisposable } from "../disposable.js";
import { CoreErrorCodes, GwenWasmError, GwenWasmPanicError } from "./engine-errors.js";
import type { EngineMemory, MemoryView } from "./engine-memory.js";
import { checkPluginApiVersion } from "./engine-types.js";
import type { GwenWasmModules, WasmModuleHandle, WasmModuleOptions } from "./engine-types.js";
import type { WasmBridgeImpl } from "./wasm-bridge.js";
import { WasmRegionView, WasmRingBuffer, type WasmMemoryRegion } from "./wasm-module-handle.js";

/**
 * `load` calls `assertState` before it fetches. The facade passes `_assertNotFaulted`.
 * `isIsolated` is keyed by the engine, not by this runner.
 * `reportCaught` and `publish` are the facade's error policy.
 * `frame` reads `_frameCountOwn` when a fill or a step fails.
 */
export interface WasmModuleRunnerDeps {
  bridge: WasmBridgeImpl;
  maxEntities: number;
  disposables: DisposableRegistry;
  memory: EngineMemory;
  assertState: (method: string) => void;
  isFaulted: () => boolean;
  isIsolated: (id: string) => boolean;
  frame: () => number;
  reportCaught: (
    err: unknown,
    hook: string,
    forced?: {
      level?: "error" | "fatal";
      code?: string;
      source?: string;
      message?: string;
      target?: GwenErrorTarget;
    },
  ) => void;
  publish: (event: GwenErrorPayload) => void;
}

interface WasmModuleTransformCopy {
  offset: number;
  bytes: Uint8Array | null;
}

interface WasmModuleEntry {
  handle: WasmModuleHandle<WebAssembly.Exports>;
  step?: (handle: WasmModuleHandle<WebAssembly.Exports>, dt: number) => void;
  transformCopy: WasmModuleTransformCopy | null;
}

/**
 * Community WASM modules for one engine: load, step, and the transform copy.
 * @internal
 */
export class WasmModuleRunner {
  private readonly _wasmModules = new Map<string, WasmModuleEntry>();
  private _sharedMemory: SharedMemoryManager | null = null;
  private _transformView: MemoryView<"u8"> | null = null;

  constructor(private readonly deps: WasmModuleRunnerDeps) {}

  async load<Exports extends WebAssembly.Exports = WebAssembly.Exports>(
    options: WasmModuleOptions<Exports>,
  ): Promise<WasmModuleHandle<Exports>> {
    this.deps.assertState("loadWasmModule");
    const existing = this._wasmModules.get(options.name);
    if (existing) {
      return existing.handle as WasmModuleHandle<Exports>;
    }

    const declared = this._declaredTransformRegion(options);
    let modulePtr = declared !== null && declared.byteOffset !== 0 ? declared.byteOffset : 0;
    const builtImports = buildTransformImports(
      modulePtr,
      /* stride */ TRANSFORM_STRIDE,
      /* maxEntities */ this.deps.maxEntities,
    );
    const gwenImports = {
      transform_buffer_ptr: () => modulePtr,
      transform_stride: builtImports.transform_stride,
      max_entities: builtImports.max_entities,
    };

    let wasmModule: WebAssembly.Module;
    let probeOffset: number | undefined;
    try {
      const response = await fetch(
        options.url instanceof URL ? options.url.toString() : options.url,
      );
      if (!response.ok) {
        throw new GwenError(
          CoreErrorCodes.WASM_LOAD_ERROR,
          `[GWEN] loadWasmModule("${options.name}"): fetch failed with status ${response.status} ${response.statusText}.`,
        );
      }
      const buffer = await response.arrayBuffer();
      wasmModule = await WebAssembly.compile(buffer);
      if (declared) {
        const exportName = `gwen_${declared.name}_ptr`;
        const hasPtrExport = WebAssembly.Module.exports(wasmModule).some(
          (item) => item.name === exportName && item.kind === "function",
        );
        if (hasPtrExport) {
          const probe = await WebAssembly.instantiate(wasmModule, { gwen: gwenImports });
          probeOffset = this._resolveTransformOffset(probe.exports, declared);
          // The real start() reads modulePtr, so publish the probe offset first.
          modulePtr = probeOffset;
        }
      }
    } catch (err) {
      throw new GwenError(
        CoreErrorCodes.WASM_LOAD_ERROR,
        `[GWEN] loadWasmModule("${options.name}"): failed to load WASM module from "${options.url}". ` +
          `Cause: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    let instance: WebAssembly.Instance;
    try {
      instance = await WebAssembly.instantiate(wasmModule, { gwen: gwenImports });
    } catch (err) {
      throw new GwenError(
        CoreErrorCodes.WASM_LOAD_ERROR,
        `[GWEN] loadWasmModule("${options.name}"): failed to load WASM module from "${options.url}". ` +
          `Cause: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Plugin API version (#92) before any resolved-region check.
    void checkPluginApiVersion(
      instance.exports,
      options.name,
      options.expectedVersion,
      options.versionPolicy,
    );

    const memory =
      instance.exports["memory"] instanceof WebAssembly.Memory
        ? instance.exports["memory"]
        : undefined;

    let transformCopy: WasmModuleTransformCopy | null = null;
    if (declared) {
      const resolved = this._resolveTransformOffset(instance.exports, declared);
      if (probeOffset !== undefined && resolved !== probeOffset) {
        throw this._regionInvalid(
          options.name,
          declared.name,
          `probe offset ${probeOffset} differs from the instance offset ${resolved}`,
        );
      }
      modulePtr = resolved;
      this._validateResolvedRegion(options.name, declared, modulePtr, memory);
      transformCopy = { offset: modulePtr, bytes: null };
      this._getOrCreateTransformPtr();
    }

    const regionMap = new Map(
      (options.memory?.regions ?? []).map((region) => [region.name, region]),
    );
    const channelMap = new Map(
      (options.channels ?? []).map((channel) => {
        if (!memory) {
          throw new GwenError(
            CoreErrorCodes.WASM_MODULE_NO_MEMORY,
            `[GWEN] loadWasmModule("${options.name}"): channel '${channel.name}' declared but ` +
              `the WASM binary does not export "memory". ` +
              `Add "(export \\"memory\\" (memory ...))" to your WASM module.`,
          );
        }
        return [channel.name, new WasmRingBuffer(memory, channel, instance.exports)];
      }),
    );

    const handle: WasmModuleHandle<Exports> = {
      name: options.name,
      exports: instance.exports as Exports,
      memory,
      region(regionName: string): WasmRegionView {
        const def = regionMap.get(regionName);
        if (!def) {
          throw new GwenError(
            CoreErrorCodes.WASM_REGION_NOT_FOUND,
            `[GWEN] WASM region '${regionName}' not found in module '${options.name}'. ` +
              `Declare it in WasmModuleOptions.memory.regions.`,
          );
        }
        if (!memory) {
          throw new GwenError(
            CoreErrorCodes.WASM_MODULE_NO_MEMORY,
            `[GWEN] WASM module '${options.name}' does not export memory — cannot create region view.`,
          );
        }
        return new WasmRegionView(memory, def);
      },
      channel(channelName: string): WasmRingBuffer {
        const channel = channelMap.get(channelName);
        if (!channel) {
          throw new GwenError(
            CoreErrorCodes.WASM_CHANNEL_NOT_FOUND,
            `[GWEN] WASM channel '${channelName}' not found in module '${options.name}'. ` +
              `Declare it in WasmModuleOptions.channels.`,
          );
        }
        return channel;
      },
    };

    const stored: WasmModuleEntry = {
      handle: handle as WasmModuleHandle<WebAssembly.Exports>,
      transformCopy,
    };
    if (options.step !== undefined) {
      stored.step = options.step as (
        handle: WasmModuleHandle<WebAssembly.Exports>,
        dt: number,
      ) => void;
    }
    this._wasmModules.set(options.name, stored);
    return handle;
  }

  get<K extends keyof GwenWasmModules>(name: K): WasmModuleHandle<GwenWasmModules[K]> {
    const entry = this._wasmModules.get(name);
    if (!entry) {
      throw new GwenError(
        CoreErrorCodes.WASM_MODULE_NOT_FOUND,
        `[GWEN] getWasmModule("${String(name)}"): no WASM module loaded under that name. ` +
          `Call engine.loadWasmModule({ name: "${String(name)}", url: ... }) first.`,
      );
    }
    return entry.handle as WasmModuleHandle<GwenWasmModules[K]>;
  }

  /** Registration order. A throwing step is reported and the next module still runs. */
  stepAll(dt: number): void {
    let needsFill = false;
    for (const [name, entry] of this._wasmModules) {
      if (entry.transformCopy && !this.deps.isIsolated(`wasm:${name}`)) {
        needsFill = true;
        break;
      }
    }
    let skipCopies = false;
    let fillTrapped = false;
    if (needsFill) {
      try {
        const ptr = this._getOrCreateTransformPtr();
        this.deps.bridge.syncTransformsToBuffer(ptr, this.deps.maxEntities);
      } catch (err: unknown) {
        fillTrapped = this._reportTransformFill(err);
        skipCopies = true;
      }
    }
    if (fillTrapped || this.deps.isFaulted()) return;
    for (const [name, entry] of this._wasmModules) {
      if (this.deps.isIsolated(`wasm:${name}`)) continue;
      try {
        if (entry.transformCopy && !skipCopies) this._copyTransformRegion(entry);
        entry.step?.(entry.handle, dt);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        const isWasmPanic =
          err instanceof WebAssembly.RuntimeError || err instanceof GwenWasmPanicError;
        this.deps.reportCaught(err, "wasm", {
          source: `wasm:${name}`,
          message: `WASM module "${name}" step failed: ${detail}`,
          target: { kind: "wasm-module", id: `wasm:${name}`, name },
          code: isWasmPanic ? CoreErrorCodes.WASM_PANIC : CoreErrorCodes.FRAME_LOOP_ERROR,
        });
      }
    }
  }

  /**
   * Dev+debug sentinel. The frame calls this only when debug instrumentation is on.
   * The flag guard keeps the message in a dev-only branch so a prod bundle drops it.
   * No shared memory means there is nothing to check.
   */
  checkSentinels(): void {
    if (__GWEN_DEV__) {
      if (!this._sharedMemory) return;
      try {
        this._sharedMemory.checkSentinels(this.deps.bridge);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        this.deps.reportCaught(err, "sentinel", {
          code: CoreErrorCodes.FRAME_LOOP_ERROR,
          message: `WASM memory sentinel violation: ${detail}`,
        });
      }
    }
  }

  /** This engine's module handles. The shared glue cache stays. */
  clear(): void {
    this._wasmModules.clear();
  }

  private _declaredTransformRegion(options: {
    name: string;
    transformRegion?: string;
    memory?: { regions: readonly WasmMemoryRegion[] };
  }): WasmMemoryRegion | null {
    const regionName = options.transformRegion;
    if (regionName === undefined) return null;
    const found = options.memory?.regions.find((region) => region.name === regionName);
    if (!found) {
      throw this._regionInvalid(options.name, regionName, "unknown region name");
    }
    const required = this.deps.maxEntities * TRANSFORM_STRIDE;
    if (found.byteLength < required) {
      throw new GwenError(
        CoreErrorCodes.WASM_MODULE_REGION_TOO_SMALL,
        `[GWEN] loadWasmModule("${options.name}"): transform region "${regionName}" is ${found.byteLength} bytes; ${required} bytes are required.`,
      );
    }
    if (found.byteOffset !== 0 && (found.byteOffset % 4 !== 0 || found.byteOffset < 0)) {
      throw this._regionInvalid(
        options.name,
        regionName,
        `offset ${found.byteOffset} is not a positive multiple of 4`,
      );
    }
    return found;
  }

  private _regionInvalid(moduleName: string, regionName: string, reason: string): GwenError {
    return new GwenError(
      CoreErrorCodes.WASM_MODULE_REGION_INVALID,
      `[GWEN] loadWasmModule("${moduleName}"): transform region "${regionName}" is invalid: ${reason}.`,
    );
  }

  private _resolveTransformOffset(exports: WebAssembly.Exports, region: WasmMemoryRegion): number {
    const exported = exports[`gwen_${region.name}_ptr`];
    if (typeof exported === "function") {
      const value: unknown = (exported as () => unknown)();
      if (typeof value === "number" && Number.isFinite(value)) return value;
      return 0;
    }
    return region.byteOffset;
  }

  private _validateResolvedRegion(
    moduleName: string,
    region: WasmMemoryRegion,
    offset: number,
    memory: WebAssembly.Memory | undefined,
  ): void {
    if (!(offset > 0) || offset % 4 !== 0) {
      throw this._regionInvalid(
        moduleName,
        region.name,
        `offset ${offset} must be a positive multiple of 4`,
      );
    }
    if (!(memory instanceof WebAssembly.Memory)) {
      throw this._regionInvalid(moduleName, region.name, "the module does not export memory");
    }
    const end = offset + region.byteLength;
    if (end > memory.buffer.byteLength) {
      throw this._regionInvalid(
        moduleName,
        region.name,
        `region ends at ${end}, past memory of ${memory.buffer.byteLength} bytes`,
      );
    }
  }

  /** @returns true when the fill trapped. Copies are skipped either way. */
  private _reportTransformFill(err: unknown): boolean {
    const isTrap = err instanceof WebAssembly.RuntimeError || err instanceof GwenWasmPanicError;
    if (isTrap) {
      const message = err instanceof Error ? err.message : String(err);
      this.deps.reportCaught(err, "sync_transforms_to_buffer", {
        level: "fatal",
        source: "gwen_core.wasm",
        code: CoreErrorCodes.WASM_PANIC,
        message,
      });
      return true;
    }
    const code = err instanceof GwenWasmError ? err.code : CoreErrorCodes.FRAME_LOOP_ERROR;
    const message = err instanceof Error ? err.message : String(err);
    this.deps.publish({
      level: "error",
      code,
      message,
      source: "gwen_core.wasm",
      error: err,
      context: { frame: this.deps.frame(), hook: "sync_transforms_to_buffer" },
    });
    return false;
  }

  private _copyTransformRegion(entry: WasmModuleEntry): void {
    const copy = entry.transformCopy;
    const memory = entry.handle.memory;
    const view = this._transformView;
    if (!copy || !memory || !view) return;
    const length = this.deps.maxEntities * TRANSFORM_STRIDE;
    let dest = copy.bytes;
    if (!dest || dest.byteLength === 0) {
      dest = new Uint8Array(memory.buffer, copy.offset, length);
      copy.bytes = dest;
    }
    dest.set(view.array);
  }

  private _getOrCreateTransformPtr(): number {
    const bridge = this.deps.bridge;
    if (!bridge.isActive()) {
      throw new GwenError(
        CoreErrorCodes.WASM_NOT_INITIALIZED,
        "[GWEN] loadWasmModule() was called before WASM bridge initialisation. " +
          "Await bridge.init() (or setupGwen()) before loading community WASM modules.",
      );
    }
    if (!this._sharedMemory) {
      this._sharedMemory = SharedMemoryManager.create(bridge, this.deps.maxEntities);
      this.deps.disposables.add(
        "wasm:shared-memory",
        createDisposable(() => {
          this._sharedMemory?.dispose(this.deps.bridge);
          this._sharedMemory = null;
        }),
      );
    }
    if (!this._transformView && this._sharedMemory) {
      const byteLength = this.deps.maxEntities * TRANSFORM_STRIDE;
      const ptr = this._sharedMemory.transformBufferPtr;
      this._transformView = this.deps.memory.view({
        name: "core:module-transforms",
        type: "u8",
        ptr: () => ptr,
        length: () => byteLength,
      });
      this.deps.disposables.add(
        "wasm:module-transforms",
        createDisposable(() => {
          this._transformView?.dispose();
          this._transformView = null;
        }),
      );
    }
    return this._sharedMemory.transformBufferPtr;
  }
}

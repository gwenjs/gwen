import { GwenError } from "@gwenjs/schema";
import type { EngineErrorBus } from "./engine-types.js";
import { CoreErrorCodes } from "./engine-errors.js";
import type { WasmBridgeImpl } from "./wasm-bridge.js";
import type { WasmMemoryRegion } from "./wasm-module-handle.js";

export type MemoryViewType = WasmMemoryRegion["type"] | "dataview";

export interface MemoryViewDescriptor<T extends MemoryViewType> {
  name: string;
  type: T;
  ptr: () => number;
  length: () => number;
}

type MemoryViewArrayOf<T extends MemoryViewType> = T extends "u8"
  ? Uint8Array
  : T extends "u16"
    ? Uint16Array
    : T extends "u32"
      ? Uint32Array
      : T extends "i8"
        ? Int8Array
        : T extends "i16"
          ? Int16Array
          : T extends "i32"
            ? Int32Array
            : T extends "f32"
              ? Float32Array
              : T extends "f64"
                ? Float64Array
                : T extends "dataview"
                  ? DataView
                  : never;

export type MemoryViewArray<T extends MemoryViewType> = MemoryViewArrayOf<T>;

export interface MemoryView<T extends MemoryViewType> {
  readonly name: string;
  readonly array: MemoryViewArray<T>;
  readonly epoch: number;
  dispose(): void;
}

const ELEMENT_BYTES: Record<MemoryViewType, number> = {
  u8: 1,
  i8: 1,
  u16: 2,
  i16: 2,
  u32: 4,
  i32: 4,
  f32: 4,
  f64: 8,
  dataview: 1,
};

const ELEMENT_ALIGN: Record<MemoryViewType, number> = {
  u8: 1,
  i8: 1,
  u16: 2,
  i16: 2,
  u32: 4,
  i32: 4,
  f32: 4,
  f64: 8,
  dataview: 1,
};

function invalid(name: string, reason: string): GwenError {
  return new GwenError(
    CoreErrorCodes.MEMORY_VIEW_INVALID,
    `Memory view "${name}" is invalid: ${reason}.`,
  );
}

function buildArray<T extends MemoryViewType>(
  type: T,
  buffer: ArrayBufferLike,
  ptr: number,
  length: number,
): MemoryViewArray<T> {
  switch (type) {
    case "u8":
      return new Uint8Array(buffer, ptr, length) as MemoryViewArray<T>;
    case "i8":
      return new Int8Array(buffer, ptr, length) as MemoryViewArray<T>;
    case "u16":
      return new Uint16Array(buffer, ptr, length) as MemoryViewArray<T>;
    case "i16":
      return new Int16Array(buffer, ptr, length) as MemoryViewArray<T>;
    case "u32":
      return new Uint32Array(buffer, ptr, length) as MemoryViewArray<T>;
    case "i32":
      return new Int32Array(buffer, ptr, length) as MemoryViewArray<T>;
    case "f32":
      return new Float32Array(buffer, ptr, length) as MemoryViewArray<T>;
    case "f64":
      return new Float64Array(buffer, ptr, length) as MemoryViewArray<T>;
    case "dataview":
      return new DataView(buffer, ptr, length) as MemoryViewArray<T>;
    default:
      throw invalid("memory", `unknown view type`);
  }
}

class MemoryViewImpl<T extends MemoryViewType> implements MemoryView<T> {
  private _array: MemoryViewArray<T> | null = null;
  private _epoch = 0;
  private _disposed = false;
  private _reason = "used after dispose";
  private readonly _name: string;
  private _desc: MemoryViewDescriptor<T> | null;

  constructor(
    private readonly _owner: EngineMemory,
    desc: MemoryViewDescriptor<T>,
  ) {
    this._name = desc.name;
    this._desc = desc;
  }

  get name(): string {
    return this._name;
  }

  get epoch(): number {
    return this._epoch;
  }

  get array(): MemoryViewArray<T> {
    if (this._disposed || this._owner.closed) {
      throw invalid(this._name, this._owner.closed ? "engine stopped" : this._reason);
    }
    const cached = this._array;
    // DataView.byteLength throws once the buffer is detached. The buffer length is 0 for both.
    if (cached !== null && cached.buffer.byteLength !== 0) return cached;
    return this._rebuild();
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._reason = "used after dispose";
    this._owner.unregister(this._name);
    this._array = null;
    this._desc = null;
  }

  markStopped(): void {
    this._disposed = true;
    this._reason = "engine stopped";
    this._array = null;
    this._desc = null;
  }

  warnIfDetached(errors: EngineErrorBus, epoch: number, frame: number): void {
    const desc = this._desc;
    const cached = this._array;
    if (desc === null || cached === null || cached.buffer.byteLength !== 0) return;
    errors.emit({
      level: "warning",
      code: CoreErrorCodes.MEMORY_VIEW_DETACHED,
      message: `[${desc.name}] re-read .array after any WASM call`,
      source: desc.name,
      context: { view: desc.name, epoch, frame },
    });
  }

  private _rebuild(): MemoryViewArray<T> {
    const desc = this._desc;
    if (desc === null) {
      throw invalid(this._name, this._reason);
    }
    const memory = this._owner.linearMemory();
    if (memory === null) {
      throw invalid(this._name, "no linear memory");
    }
    const ptr = desc.ptr();
    const length = desc.length();
    if (!(length > 0) || !Number.isInteger(length)) {
      throw invalid(this._name, "length must be > 0");
    }
    const type = desc.type;
    const bytes = type === "dataview" ? length : length * ELEMENT_BYTES[type];
    const align = ELEMENT_ALIGN[type];
    const buffer = memory.buffer;
    if (ptr < 0 || ptr % align !== 0 || ptr + bytes > buffer.byteLength) {
      throw invalid(this._name, "out of bounds or misaligned");
    }
    const next = buildArray(type, buffer, ptr, length);
    this._array = next;
    this._epoch = this._owner.epoch;
    return next;
  }
}

/**
 * Per-engine views over gwen-core linear memory.
 * `epoch` starts at 0 after bridge init and increases once per growth the engine sees.
 */
export class EngineMemory {
  private _epoch = 0;
  private _closed = false;
  private readonly _views = new Map<string, MemoryViewImpl<MemoryViewType>>();

  constructor(
    private readonly _bridge: WasmBridgeImpl,
    private readonly _errors: EngineErrorBus,
  ) {}

  get epoch(): number {
    return this._epoch;
  }

  get closed(): boolean {
    return this._closed;
  }

  linearMemory(): WebAssembly.Memory | null {
    return this._bridge.getLinearMemory();
  }

  view<T extends MemoryViewType>(desc: MemoryViewDescriptor<T>): MemoryView<T> {
    if (this._closed) {
      throw invalid(desc.name, "engine stopped");
    }
    if (this._views.has(desc.name)) {
      throw invalid(desc.name, "duplicate name");
    }
    const view = new MemoryViewImpl(this, desc);
    this._views.set(desc.name, view as MemoryViewImpl<MemoryViewType>);
    return view;
  }

  unregister(name: string): void {
    this._views.delete(name);
  }

  /** Growth was observed. Bumps the epoch and, in dev, warns for detached views. */
  noteGrowth(frame: number): void {
    this._epoch += 1;
    if (__GWEN_DEV__) {
      for (const view of this._views.values()) {
        view.warnIfDetached(this._errors, this._epoch, frame);
      }
    }
  }

  disposeAll(): void {
    this._closed = true;
    for (const view of this._views.values()) {
      view.markStopped();
    }
    this._views.clear();
  }
}

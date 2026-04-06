/**
 * @file RFC-008 — WasmRegionView, WasmRingBuffer, and WASM memory region types.
 *
 * Provides live typed views into WASM linear memory that automatically
 * reflect the current buffer after `memory.grow()` calls.
 */

// ─── Memory region types ─────────────────────────────────────────────────────

/**
 * A named slice of WASM linear memory.
 *
 * Accessible on a loaded handle via `handle.region('agents').f32`.
 */
export interface WasmMemoryRegion {
  /** Stable name used to access the view. */
  name: string;
  /** Byte offset from the start of WASM linear memory. */
  byteOffset: number;
  /** Byte length of the region. */
  byteLength: number;
  /** Primary element type for the typed accessor. */
  type: 'u8' | 'u16' | 'u32' | 'i8' | 'i16' | 'i32' | 'f32' | 'f64';
}

/**
 * Configuration for a ring-buffer channel between TypeScript and WASM.
 */
export interface WasmChannelOptions {
  /** Stable name used to access the channel: `handle.channel('commands')`. */
  name: string;
  /** Data flow direction. */
  direction: 'ts→wasm' | 'wasm→ts';
  /** Maximum number of items in the ring buffer. */
  capacity: number;
  /** Size of one item in bytes. Must be a multiple of 4. */
  itemByteSize: number;
  /**
   * Optional explicit byte offset override. When omitted, the engine
   * auto-detects the offset by calling `gwen_{name}_ring_ptr()` on the
   * module exports. Falls back to 65536 if neither is available.
   */
  byteOffset?: number;
}

/**
 * Named memory regions and optional ring-buffer channels for a WASM module.
 */
export interface WasmMemoryOptions {
  regions: WasmMemoryRegion[];
  channels?: WasmChannelOptions[];
}

// ─── WasmRegionView ──────────────────────────────────────────────────────────

/**
 * A lazy typed view into a named WASM memory region.
 *
 * A new TypedArray is created on each property access so views are always
 * backed by the current `ArrayBuffer` after a `memory.grow()` call.
 *
 * @example
 * ```typescript
 * const agents = handle.region('agents')
 * agents.f32[0] = 1.0   // always live — never stale after memory.grow()
 * ```
 */
export class WasmRegionView {
  constructor(
    private readonly _memory: WebAssembly.Memory,
    private readonly _def: WasmMemoryRegion,
  ) {}

  /** Raw byte buffer slice for this region (copy). */
  get buffer(): ArrayBuffer {
    return this._memory.buffer.slice(
      this._def.byteOffset,
      this._def.byteOffset + this._def.byteLength,
    );
  }

  /** Live `Uint8Array` view into this region. */
  get u8(): Uint8Array {
    return new Uint8Array(this._memory.buffer, this._def.byteOffset, this._def.byteLength);
  }

  /** Live `Uint16Array` view into this region. */
  get u16(): Uint16Array {
    return new Uint16Array(
      this._memory.buffer,
      this._def.byteOffset,
      this._def.byteLength / Uint16Array.BYTES_PER_ELEMENT,
    );
  }

  /** Live `Uint32Array` view into this region. */
  get u32(): Uint32Array {
    return new Uint32Array(
      this._memory.buffer,
      this._def.byteOffset,
      this._def.byteLength / Uint32Array.BYTES_PER_ELEMENT,
    );
  }

  /** Live `Int8Array` view into this region. */
  get i8(): Int8Array {
    return new Int8Array(this._memory.buffer, this._def.byteOffset, this._def.byteLength);
  }

  /** Live `Int16Array` view into this region. */
  get i16(): Int16Array {
    return new Int16Array(
      this._memory.buffer,
      this._def.byteOffset,
      this._def.byteLength / Int16Array.BYTES_PER_ELEMENT,
    );
  }

  /** Live `Int32Array` view into this region. */
  get i32(): Int32Array {
    return new Int32Array(
      this._memory.buffer,
      this._def.byteOffset,
      this._def.byteLength / Int32Array.BYTES_PER_ELEMENT,
    );
  }

  /** Live `Float32Array` view into this region. */
  get f32(): Float32Array {
    return new Float32Array(
      this._memory.buffer,
      this._def.byteOffset,
      this._def.byteLength / Float32Array.BYTES_PER_ELEMENT,
    );
  }

  /** Live `Float64Array` view into this region. */
  get f64(): Float64Array {
    return new Float64Array(
      this._memory.buffer,
      this._def.byteOffset,
      this._def.byteLength / Float64Array.BYTES_PER_ELEMENT,
    );
  }
}

// ─── WasmRingBuffer ──────────────────────────────────────────────────────────

/**
 * A fixed-capacity ring buffer backed by WASM linear memory.
 *
 * Used for efficient TS↔WASM message passing without heap allocation on each transfer.
 *
 * @example
 * ```typescript
 * const cmd = handle.channel('commands')
 * const data = new Float32Array([1, 0, 0, 0])
 * if (cmd.push(data)) {
 *   console.log('command enqueued')
 * }
 * ```
 */
export class WasmRingBuffer {
  private readonly _memory: WebAssembly.Memory;
  private readonly _byteOffset: number;
  private readonly _capacity: number;
  private readonly _itemByteSize: number;
  private _head = 0;
  private _tail = 0;

  /**
   * Constructs a ring buffer with auto-detected or explicit byte offset.
   *
   * The byteOffset is resolved using this priority chain:
   * 1. `opts.byteOffset` — explicit override (highest priority)
   * 2. `exports?.[`gwen_${opts.name}_ring_ptr`]` — auto-detection via exported function
   * 3. `65536` — fallback to first 64 KiB page boundary (past shadow stack)
   *
   * @param memory - The WASM linear memory instance.
   * @param opts - Channel configuration including name, capacity, and optional explicit offset.
   * @param exports - Optional WASM module exports for auto-detecting byteOffset.
   */
  constructor(memory: WebAssembly.Memory, opts: WasmChannelOptions, exports?: WebAssembly.Exports) {
    this._memory = memory;

    // Resolve byteOffset using priority chain.
    let byteOffset: number;
    if (opts.byteOffset !== undefined) {
      // Explicit override has highest priority.
      byteOffset = opts.byteOffset;
    } else {
      // Try auto-detection via exported function.
      const ptrExportName = `gwen_${opts.name}_ring_ptr`;
      const ptrExport = exports?.[ptrExportName];
      if (typeof ptrExport === 'function') {
        byteOffset = (ptrExport as () => number)();
      } else {
        // Fallback: first 64 KiB page boundary, past shadow stack.
        byteOffset = 65_536;
      }
    }

    this._byteOffset = byteOffset;
    this._capacity = opts.capacity;
    this._itemByteSize = opts.itemByteSize;
  }

  /**
   * Enqueue `data` into the ring buffer.
   *
   * @param data - The item to enqueue. Must be exactly `itemByteSize` bytes.
   * @returns `true` if the item was enqueued; `false` if the buffer is full.
   */
  push(data: ArrayBufferView): boolean {
    if (this.full) return false;
    const dst = new Uint8Array(
      this._memory.buffer,
      this._byteOffset + this._tail * this._itemByteSize,
      this._itemByteSize,
    );
    dst.set(new Uint8Array(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength));
    this._tail = (this._tail + 1) % this._capacity;
    return true;
  }

  /**
   * Dequeue one item from the ring buffer into `dest`.
   *
   * @param dest - Destination buffer. Must be at least `itemByteSize` bytes.
   * @returns `true` if an item was read; `false` if the buffer is empty.
   */
  pop(dest: ArrayBufferView): boolean {
    if (this.empty) return false;
    const src = new Uint8Array(
      this._memory.buffer,
      this._byteOffset + this._head * this._itemByteSize,
      this._itemByteSize,
    );
    new Uint8Array(dest.buffer as ArrayBuffer, dest.byteOffset, dest.byteLength).set(src);
    this._head = (this._head + 1) % this._capacity;
    return true;
  }

  /** `true` when no items are available. */
  get empty(): boolean {
    return this._head === this._tail;
  }

  /** `true` when no more items can be pushed. */
  get full(): boolean {
    return (this._tail + 1) % this._capacity === this._head;
  }

  /** Number of items currently in the buffer. */
  get length(): number {
    return (this._tail - this._head + this._capacity) % this._capacity;
  }
}

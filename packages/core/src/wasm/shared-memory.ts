/**
 * SharedMemoryManager — shared buffer between gwen-core and WASM plugins.
 *
 * ## Mechanism
 * `gwen-core.wasm` allocates a buffer inside its own linear memory via
 * `alloc_shared_buffer(byteLength)`. This raw pointer is handed to every
 * WASM plugin so they can read/write the same memory region without going
 * through JavaScript. Zero copies, zero GC pressure.
 *
 * ## Transform buffer layout (stride = 32 bytes per entity slot)
 * ```
 * slot_offset = entity_index * TRANSFORM_STRIDE
 *
 * slot_offset +  0 : pos_x    (f32, 4 B) — world X position in metres
 * slot_offset +  4 : pos_y    (f32, 4 B) — world Y position in metres
 * slot_offset +  8 : rotation (f32, 4 B) — angle in radians
 * slot_offset + 12 : scale_x  (f32, 4 B)
 * slot_offset + 16 : scale_y  (f32, 4 B)
 * slot_offset + 20 : flags    (u32, 4 B) — bit 0 = physics_active, bit 1 = dirty
 * slot_offset + 24 : reserved (8  B)     — reserved for future use
 * ```
 *
 * ## Sentinel guards
 * Each allocated region is followed by a 4-byte sentinel word (`0xDEADBEEF`).
 * `checkSentinels()` verifies them every frame (debug mode only). If a Rust
 * plugin writes past its `MemoryRegion.byteLength`, the sentinel is overwritten
 * and the check throws — turning silent heap corruption into an immediate error.
 *
 * ## Usage
 * ```typescript
 * // Called once in createEngine(), after initWasm()
 * const sharedMemory = SharedMemoryManager.create(bridge, 10_000);
 *
 * // Called for each WASM plugin before onInit()
 * const region = sharedMemory.allocateRegion('physics2d', 10_000 * TRANSFORM_STRIDE);
 * // region.ptr is passed directly to the Rust constructor:
 * //   new WasmPhysics2DPlugin(gravity, region.ptr, maxEntities)
 * ```
 */

import { GwenConfigError } from '../engine/config-error.js';
import type { WasmBridge } from '../engine/wasm-bridge.js';

// ─── Public constants ─────────────────────────────────────────────────────────

/**
 * Maximum allowed SharedArrayBuffer size in bytes (256 MiB).
 *
 * Enough for approximately 2 million entities × 128 bytes each.
 * Raise this constant only if you understand the memory implications
 * for the target browser/runtime environment.
 */
export const MAX_SAB_BYTES = 256 * 1024 * 1024; // 256 MiB

/** Bytes per entity slot in the shared 2D transform buffer. */
export const TRANSFORM_STRIDE = 32;

/**
 * Bytes per entity slot in the shared 3D transform buffer (STRIDE 48).
 *
 * ## Layout (48 bytes, 16-byte aligned)
 * ```
 * slot_offset +  0 : pos_x   (f32, 4 B)
 * slot_offset +  4 : pos_y   (f32, 4 B)
 * slot_offset +  8 : pos_z   (f32, 4 B)
 * slot_offset + 12 : rot_x   (f32, 4 B) — quaternion x
 * slot_offset + 16 : rot_y   (f32, 4 B) — quaternion y
 * slot_offset + 20 : rot_z   (f32, 4 B) — quaternion z
 * slot_offset + 24 : rot_w   (f32, 4 B) — quaternion w (identity = 1)
 * slot_offset + 28 : scale_x (f32, 4 B)
 * slot_offset + 32 : scale_y (f32, 4 B)
 * slot_offset + 36 : scale_z (f32, 4 B)
 * slot_offset + 40 : flags   (u32, 4 B) — bit 0 = physics_active, bit 1 = dirty
 * slot_offset + 44 : reserved (4 B)     — 16-byte alignment padding
 * ```
 */
export const TRANSFORM3D_STRIDE = 48;

/** Byte offset of the `flags` field within a single entity slot. */
export const FLAGS_OFFSET = 20;

/** Byte offset of the `flags` field within a single 3D entity slot. */
export const FLAGS3D_OFFSET = 40;

/** Bit flag: this entity slot is actively managed by a physics plugin. */
export const FLAG_PHYSICS_ACTIVE = 0b01;

/**
 * Sentinel value written at the end of each allocated region.
 * Overwriting it signals a buffer-overrun bug in a Rust plugin.
 * Value: `0xDEADBEEF` (classic memory-safety canary).
 */
export const SENTINEL = 0xdeadbeef;

/** Size in bytes of the sentinel guard appended to each region. */
const SENTINEL_BYTES = 4;

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * A contiguous slice of the shared buffer owned by one plugin.
 *
 * The `ptr` field is a raw address inside `gwen-core`'s WASM linear memory.
 * It must be passed to the Rust plugin constructor as `usize`; the plugin
 * then reads and writes the buffer directly without any JS involvement.
 *
 * @example
 * ```typescript
 * // TypeScript side
 * const region = sharedMemory.allocateRegion('physics2d', maxEntities * 32);
 *
 * // Rust side (receives region.ptr as `shared_ptr: usize`)
 * let x = unsafe { *((shared_ptr + entity_index * 32) as *const f32) };
 * ```
 */
export interface MemoryRegion {
  /** Unique owner identifier (matches `GwenWasmPlugin.id`). */
  readonly pluginId: string;
  /** Raw pointer into gwen-core's WASM linear memory. */
  readonly ptr: number;
  /**
   * Usable size in bytes, aligned to 8 bytes.
   * The Rust plugin must never write beyond `ptr + byteLength - 1`.
   */
  readonly byteLength: number;
  /** Byte offset of this region from the start of the full shared buffer. */
  readonly byteOffset: number;
}

// ─── SharedMemoryManager ─────────────────────────────────────────────────────

/**
 * Manages a single shared buffer allocated in `gwen-core`'s WASM linear memory.
 *
 * All WASM plugins receive a dedicated `MemoryRegion` slice of this buffer
 * via their `onInit(bridge, region, api)` call. Regions are allocated linearly
 * and never overlap — deterministic ordering is guaranteed because allocation
 * happens sequentially before any plugin receives its region.
 *
 * ### Sentinel guards (debug mode)
 * A 4-byte sentinel (`0xDEADBEEF`) is written immediately after each region.
 * Call `checkSentinels(bridge)` once per frame (or on demand) to verify that
 * no plugin has overflowed its buffer. This check is O(n_plugins) and
 * negligible compared to the physics step.
 */
export class SharedMemoryManager {
  private readonly basePtr: number;
  private readonly totalBytes: number;
  private usedBytes = 0;
  private readonly regions = new Map<string, MemoryRegion>();

  /** Sentinel addresses: region pluginId → address of the 4-byte guard. */
  private readonly sentinelAddrs = new Map<string, number>();

  private constructor(basePtr: number, totalBytes: number) {
    this.basePtr = basePtr;
    this.totalBytes = totalBytes;
  }

  // ── Factory ────────────────────────────────────────────────────────────────

  /**
   * Allocate the shared buffer inside gwen-core's WASM linear memory.
   *
   * The total allocation is `maxEntities * TRANSFORM_STRIDE` bytes plus
   * headroom for per-plugin sentinel guards.
   *
   * @param bridge       Active WasmBridge — `initWasm()` must have been called.
   * @param maxEntities  Number of entity slots (default: 10 000).
   *
   * @throws {Error} If the bridge is not active or the allocation returns null.
   */
  static create(bridge: WasmBridge, maxEntities = 10_000): SharedMemoryManager {
    if (!bridge.isActive()) {
      throw new Error(
        '[GWEN:SharedMemory] initWasm() must be called before SharedMemoryManager.create().',
      );
    }

    // Extra headroom: 64 bytes per potential plugin for sentinel guards + alignment padding.
    // In practice GWEN v1 has at most a handful of plugins, so 1 KB is generous.
    const sentinelHeadroom = 1024;
    const totalBytes = maxEntities * TRANSFORM_STRIDE + sentinelHeadroom;

    // ── Overallocation guard ─────────────────────────────────────────────────
    // Prevent silent OOM crashes from absurdly large maxEntities values.
    if (totalBytes > MAX_SAB_BYTES) {
      const mb = (totalBytes / 1024 / 1024).toFixed(1);
      const maxMb = (MAX_SAB_BYTES / 1024 / 1024).toFixed(0);
      throw new GwenConfigError(
        'maxEntities',
        maxEntities,
        `Requested ${mb} MiB of shared memory exceeds the ${maxMb} MiB limit. ` +
          `Reduce maxEntities or increase MAX_SAB_BYTES if you know what you're doing.`,
      );
    }

    const ptr = bridge.allocSharedBuffer(totalBytes);

    if (ptr === 0) {
      throw new Error(
        '[GWEN:SharedMemory] alloc_shared_buffer() returned a null pointer — out of WASM memory?',
      );
    }

    return new SharedMemoryManager(ptr, totalBytes);
  }

  // ── Region allocation ──────────────────────────────────────────────────────

  /**
   * Carve out a named region from the shared buffer and write a sentinel guard.
   *
   * Regions are allocated **linearly** in declaration order. The sentinel is
   * placed immediately after the usable bytes and before the next region's
   * start, ensuring that any overrun from the current region hits the guard.
   *
   * ```
   * | region A (byteLength) | SENTINEL (4 B) | padding | region B … |
   * ```
   *
   * @param pluginId   Must match `GwenWasmPlugin.id`. Calling twice with the
   *                   same id is idempotent — returns the existing region.
   * @param byteLength Requested usable bytes. Rounded up to the nearest 8-byte
   *                   multiple. The actual allocation also reserves
   *                   `SENTINEL_BYTES` after the usable area.
   *
   * @throws {Error} If there is not enough space remaining in the buffer.
   */
  allocateRegion(pluginId: string, byteLength: number): MemoryRegion {
    if (byteLength <= 0) {
      throw new Error(
        `[GWEN:SharedMemory] Invalid byteLength ${byteLength} for plugin '${pluginId}'.`,
      );
    }

    // Idempotent — return existing region without re-allocating
    if (this.regions.has(pluginId)) {
      return this.regions.get(pluginId)!;
    }

    // Round up to 8-byte alignment (required by wasm-bindgen allocator)
    const aligned = Math.ceil(byteLength / 8) * 8;
    // Total reservation: usable bytes + sentinel guard
    const totalReservation = aligned + SENTINEL_BYTES;

    if (this.usedBytes + totalReservation > this.totalBytes) {
      throw new Error(
        `[GWEN:SharedMemory] Insufficient space for plugin '${pluginId}': ` +
          `need ${totalReservation}B (${aligned}B data + ${SENTINEL_BYTES}B sentinel), ` +
          `only ${this.totalBytes - this.usedBytes}B remaining.`,
      );
    }

    const region: MemoryRegion = {
      pluginId,
      ptr: this.basePtr + this.usedBytes,
      byteLength: aligned,
      byteOffset: this.usedBytes,
    };

    // Sentinel address = immediately after the usable data
    const sentinelAddr = this.basePtr + this.usedBytes + aligned;
    this.sentinelAddrs.set(pluginId, sentinelAddr);

    this.usedBytes += totalReservation;
    this.regions.set(pluginId, region);

    return region;
  }

  // ── Sentinel integrity check ───────────────────────────────────────────────

  /**
   * Verify that no plugin has written past its allocated region.
   *
   * Reads the 4-byte sentinel at the end of each region and compares it
   * against `SENTINEL` (`0xDEADBEEF`). Should be called once per frame in
   * debug mode, **after** `dispatchWasmStep` and **before** reading the buffer
   * back into the ECS — the only moment an overrun could have occurred.
   *
   * This method reads directly from `gwen-core`'s WASM linear memory via
   * the bridge. It is a pure read — no ECS state is modified.
   *
   * @param bridge  Active WasmBridge — needed to access the linear memory view.
   *
   * @throws {Error} If any sentinel has been overwritten, indicating a
   *   buffer-overrun bug in the offending Rust plugin.
   */
  checkSentinels(bridge: WasmBridge): void {
    const memory = bridge.getLinearMemory();
    if (!memory) return; // Not available in test environments

    // Re-read buffer in case memory.grow() invalidated the previous ArrayBuffer
    const view = new DataView(memory.buffer);

    for (const [pluginId, sentinelAddr] of this.sentinelAddrs) {
      // sentinelAddr is an address in gwen-core's linear memory.
      // The DataView base is memory.buffer which starts at address 0,
      // so sentinelAddr is already the correct byte offset.
      const value = view.getUint32(sentinelAddr, /* littleEndian= */ true);
      if (value !== SENTINEL) {
        throw new Error(
          `[GWEN:SharedMemory] Sentinel overwrite detected for plugin '${pluginId}'!\n` +
            `Expected 0x${SENTINEL.toString(16).toUpperCase()} at address ${sentinelAddr}, ` +
            `found 0x${value.toString(16).toUpperCase()}.\n` +
            `The plugin wrote past its MemoryRegion.byteLength boundary.`,
        );
      }
    }
  }

  /**
   * Write the sentinel values into the shared buffer.
   *
   * Must be called **once**, after all regions have been allocated via
   * {@link allocateRegion} and before the first {@link checkSentinels} call.
   * Typically invoked during engine initialisation, after all plugins have
   * registered their regions.
   *
   * Re-exposed for testing purposes.
   *
   * @param bridge  Active WasmBridge.
   * @internal
   */
  _writeSentinels(bridge: WasmBridge): void {
    const memory = bridge.getLinearMemory();
    if (!memory) return;

    const view = new DataView(memory.buffer);
    for (const [, sentinelAddr] of this.sentinelAddrs) {
      view.setUint32(sentinelAddr, SENTINEL, /* littleEndian= */ true);
    }
  }

  // ── Core transform region ──────────────────────────────────────────────────

  /**
   * Returns a descriptor for the full shared buffer as used by gwen-core.
   *
   * This region spans the entire allocation (`basePtr` → `basePtr + totalBytes`).
   * It is passed to `sync_transforms_to_buffer` / `sync_transforms_from_buffer`
   * which iterate over all entity slots to sync ECS ↔ plugins each frame.
   */
  getTransformRegion(): MemoryRegion {
    return {
      pluginId: '__core__',
      ptr: this.basePtr,
      byteLength: this.totalBytes,
      byteOffset: 0,
    };
  }

  // ── Diagnostics ───────────────────────────────────────────────────────────

  /** Total bytes consumed by plugin regions (including sentinel guards). */
  get allocatedBytes(): number {
    return this.usedBytes;
  }

  /** Total bytes in the shared buffer (includes sentinel headroom). */
  get capacityBytes(): number {
    return this.totalBytes;
  }

  /** Snapshot of all allocated region descriptors, in allocation order. */
  get allRegions(): MemoryRegion[] {
    return Array.from(this.regions.values());
  }

  /**
   * Absolute address of the transform buffer in WASM linear memory
   * (identical to the raw pointer returned by `alloc_shared_buffer`).
   * Pass directly to {@link buildTransformImports} as `transformPtr`.
   */
  get transformBufferPtr(): number {
    return this.basePtr;
  }
}

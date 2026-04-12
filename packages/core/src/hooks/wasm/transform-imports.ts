/**
 * Host-function imports for community WASM plugins to access the gwen-core transform buffer.
 *
 * V1 implementation: passes JavaScript accessor functions via `importObject.gwen` so community
 * plugins can call them from Rust once during init() to cache the buffer address, stride,
 * and entity count. This avoids repeated JS calls and GC overhead on the hot path.
 *
 * @module
 */

/**
 * Accessor functions provided by the host engine to a community WASM plugin.
 *
 * Each function returns a stable value captured at construction time.
 * Rust plugins should call these once during `init()` and cache the results
 * locally — calling them on the hot path incurs unnecessary JS↔WASM overhead.
 */
export interface GwenTransformImports extends WebAssembly.ModuleImports {
  /**
   * Returns the byte offset of the transform buffer in WASM linear memory.
   *
   * @example
   * ```rust
   * // Inside the WASM plugin (Rust)
   * extern "C" {
   *   fn transform_buffer_ptr() -> u32;
   * }
   * let ptr = unsafe { transform_buffer_ptr() };
   * ```
   */
  readonly transform_buffer_ptr: () => number;

  /**
   * Returns the byte stride between consecutive entity transform entries.
   *
   * @example For 2D: 32 bytes (pos_x, pos_y, rotation, scale_x, scale_y, flags, reserved)
   * @example For 3D: 48 bytes (pos_x, pos_y, pos_z, rot quaternion, scale_x/y/z, flags, padding)
   */
  readonly transform_stride: () => number;

  /**
   * Returns the maximum number of entities in the transform buffer.
   *
   * This is a hard limit; plugins must clamp their entity IDs to [0, max_entities).
   */
  readonly max_entities: () => number;
}

/**
 * Builds the `importObject.gwen` accessor functions for a community plugin.
 *
 * Call this once when loading a community WASM module, then pass the result as:
 * ```typescript
 * await WebAssembly.instantiate(buffer, { gwen: gwenImports })
 * ```
 *
 * This function never throws; it is a pure closure factory.
 *
 * @param transformPtr - Byte offset of the transform buffer (from `SharedMemoryManager.transformBufferPtr`)
 * @param stride - Byte stride per entity transform entry (e.g., `TRANSFORM_STRIDE` = 32 for 2D)
 * @param maxEntities - Maximum entity count (e.g., engine config `maxEntities`)
 * @returns `GwenTransformImports` object to pass as `importObject.gwen`
 *
 * @example
 * ```typescript
 * import { buildTransformImports, TRANSFORM_STRIDE } from './wasm/transform-imports';
 *
 * const gwenImports = buildTransformImports(
 *   sharedMemory.transformBufferPtr,
 *   TRANSFORM_STRIDE,
 *   engine.maxEntities,
 * );
 * const instance = await WebAssembly.instantiate(wasmBuffer, { gwen: gwenImports });
 * ```
 */
export function buildTransformImports(
  transformPtr: number,
  stride: number,
  maxEntities: number,
): GwenTransformImports {
  return {
    transform_buffer_ptr: () => transformPtr,
    transform_stride: () => stride,
    max_entities: () => maxEntities,
  };
}

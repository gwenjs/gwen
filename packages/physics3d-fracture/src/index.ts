/**
 * @gwenjs/physics3d-fracture
 *
 * Voronoi mesh fracture — standalone WASM module.
 *
 * This module is designed to be loaded at runtime via `engine.loadWasmModule()`.
 * Import this package to get typed access to the fracture API and to reference
 * the WASM binary.
 *
 * @example
 * ```ts
 * import { voronoi_fracture } from '@gwenjs/physics3d-fracture';
 * import initFracture from '@gwenjs/physics3d-fracture';
 *
 * await initFracture();
 * const shards = voronoi_fracture(vertices, indices, ix, iy, iz, 8, 42);
 * ```
 *
 * @see {@link https://gwenjs.dev/docs/physics3d/fracture} for usage guide.
 */

/**
 * Fracture a triangle mesh into `shard_count` pieces using Voronoi site assignment.
 *
 * @param vertices_flat - Source mesh vertex positions `[x0,y0,z0, x1,y1,z1, ...]`.
 *   Length must be a non-zero multiple of 3.
 * @param indices_flat - Source mesh triangle indices `[a0,b0,c0, ...]`.
 *   Length must be a non-zero multiple of 3.
 * @param impact_x - X coordinate of the impact point in local mesh space. Used as the first Voronoi site.
 * @param impact_y - Y coordinate of the impact point in local mesh space.
 * @param impact_z - Z coordinate of the impact point in local mesh space.
 * @param shard_count - Number of desired shards (1–64 recommended; clamped to 1 minimum).
 * @param seed - LCG random seed for reproducible fracture patterns.
 * @returns A flat `Float32Array` buffer encoding all non-empty shards.
 *   Returns an empty array if `vertices_flat` or `indices_flat` is empty.
 */
export { voronoi_fracture } from '../wasm/gwen_physics3d_fracture.js';

/**
 * Initialize the fracture WASM module synchronously from a pre-compiled
 * `WebAssembly.Module` or raw bytes (`BufferSource`).
 *
 * Prefer this form in Node.js or when the binary is already in memory.
 *
 * @param module - Either `{ module: SyncInitInput }` or a `SyncInitInput` directly
 *   (`BufferSource | WebAssembly.Module`). The bare `SyncInitInput` form is deprecated.
 * @returns The `InitOutput` instance exposing the module's memory and exports.
 */
export { initSync } from '../wasm/gwen_physics3d_fracture.js';

export type {
  InitInput,
  InitOutput,
  SyncInitInput,
} from '../wasm/gwen_physics3d_fracture.js';

/** Initialize the fracture WASM module asynchronously. Must be called before `voronoi_fracture`.
 *
 * Accepts a URL, `Request`, `Response`, raw bytes, or a pre-compiled
 * `WebAssembly.Module`. When called without arguments the module will attempt
 * to fetch the WASM binary from the default URL embedded at build time.
 *
 * @param module_or_path - Optional source for the WASM binary.
 * @returns A promise that resolves to the `InitOutput` once the module is ready.
 *
 * @example
 * ```ts
 * import initFracture, { voronoi_fracture } from '@gwenjs/physics3d-fracture';
 *
 * await initFracture();
 * const shards = voronoi_fracture(vertices, indices, ix, iy, iz, 8, 42);
 * ```
 */
export { default as initFracture } from '../wasm/gwen_physics3d_fracture.js';

import type { LayerSelector } from "@gwenjs/physics-core";
import type { EntityId } from "@gwenjs/schema";

// ─── Bulk spawn ───────────────────────────────────────────────────────────────

/**
 * Options accepted by {@link Physics3DAPI.bulkSpawnStaticBoxes}.
 */
export interface BulkStaticBoxesOptions {
  /**
   * Flat position buffer `[x0,y0,z0, x1,y1,z1, ...]`.
   * Length must be a multiple of 3. `N = positions.length / 3`.
   */
  positions: Float32Array;
  /**
   * Flat half-extents buffer.
   * Either 3 floats (uniform for all N boxes) or `N × 3` floats (per-box).
   */
  halfExtents: Float32Array;
  /** Surface friction coefficient ≥ 0. @default 0.5 */
  friction?: number;
  /** Bounciness coefficient in [0, 1]. @default 0.0 */
  restitution?: number;
  /** Collision layer each box belongs to. A name, a raw bitmask, or a list OR-ed together. */
  layer?: LayerSelector;
  /** Layers each box collides with. Same shapes as `layer`. */
  mask?: LayerSelector;
}

/**
 * Result returned by {@link Physics3DAPI.bulkSpawnStaticBoxes}.
 */
export interface BulkStaticBoxesResult {
  /** Packed EntityIds for all successfully created bodies, in spawn order. */
  entityIds: EntityId[];
  /** Number of bodies actually created (may be less than N on failure). */
  count: number;
}

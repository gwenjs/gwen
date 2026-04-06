import type { ColliderHandle3D } from './bodies';

// ─── Colliders ─────────────────────────────────────────────────────────────────

/**
 * Discriminated union of supported 3D collider shapes.
 */
export type Physics3DColliderShape =
  | { type: 'box'; halfX: number; halfY: number; halfZ: number }
  | { type: 'sphere'; radius: number }
  | { type: 'capsule'; radius: number; halfHeight: number }
  | { type: 'mesh'; vertices: Float32Array; indices: Uint32Array }
  | { type: 'convex'; vertices: Float32Array }
  | {
      type: 'heightfield';
      /** Row-major flat array of rows × cols height values. */
      heights: Float32Array;
      /** Number of rows (Z axis). */
      rows: number;
      /** Number of columns (X axis). */
      cols: number;
      /** World-space width of the entire heightfield in metres. @default 1 */
      scaleX?: number;
      /** World-space maximum height multiplier in metres. @default 1 */
      scaleY?: number;
      /** World-space depth of the entire heightfield in metres. @default 1 */
      scaleZ?: number;
    };

/**
 * Built-in material presets for common surface types.
 *
 * - `'default'` — Standard values.
 * - `'ice'`     — Very low friction.
 * - `'rubber'`  — High friction and moderate restitution.
 * - `'metal'`   — Low friction, high density.
 */
export type Physics3DMaterialPreset = 'default' | 'ice' | 'rubber' | 'metal';

/** Numeric material values for a Physics3DMaterialPreset. */
export interface Physics3DMaterialValues {
  friction: number;
  restitution: number;
  density: number;
}

/** Lookup table for built-in material presets. */
export const PHYSICS3D_MATERIAL_PRESETS: Record<Physics3DMaterialPreset, Physics3DMaterialValues> =
  {
    default: { friction: 0.5, restitution: 0.0, density: 1.0 },
    ice: { friction: 0.02, restitution: 0.0, density: 0.9 },
    rubber: { friction: 1.2, restitution: 0.6, density: 1.2 },
    metal: { friction: 0.3, restitution: 0.05, density: 7.8 },
  } as const;

/**
 * Options for a single collider attached to a body.
 */
export interface Physics3DColliderOptions {
  /** Collider shape definition. */
  shape: Physics3DColliderShape;
  /** Local X offset from the body centre in metres. @default 0 */
  offsetX?: number;
  /** Local Y offset from the body centre in metres. @default 0 */
  offsetY?: number;
  /** Local Z offset from the body centre in metres. @default 0 */
  offsetZ?: number;
  /**
   * When true, generates collision events but produces no physical response.
   * @default false
   */
  isSensor?: boolean;
  /**
   * Friction coefficient ≥ 0.
   * @default 0.5
   */
  friction?: number;
  /**
   * Bounciness in [0, 1].
   * @default 0.0
   */
  restitution?: number;
  /**
   * Collider density in kg/m³. Used when body mass is 0.
   * @default 1.0
   */
  density?: number;
  /**
   * Named collision layers this collider belongs to, or numeric bitmask values.
   * Named layers are resolved via the layer registry; numbers are used directly.
   * `undefined` defaults to all-layers (0xFFFFFFFF).
   */
  layers?: (string | number)[];
  /**
   * Named layers this collider collides with, or numeric bitmask values.
   * `undefined` defaults to all-layers (0xFFFFFFFF).
   */
  mask?: (string | number)[];
  /**
   * Stable numeric collider id propagated to collision events and sensor state.
   * Defaults to the collider's array index when omitted.
   */
  colliderId?: number;
  /**
   * Apply a built-in material preset. Preset values are used only for properties
   * not explicitly set on this options object.
   */
  materialPreset?: Physics3DMaterialPreset;
  /**
   * URL to a pre-baked BVH binary asset emitted at Vite build time.
   * When set on a `mesh`-type collider, the plugin uses an async fetch pipeline
   * instead of the synchronous `physics3d_add_mesh_collider` path.
   *
   * Set automatically by the `gwen:physics3d` Vite plugin — do not write manually.
   * @internal
   */
  __bvhUrl?: string;
}

/** Handle returned by {@link useBoxCollider}. */
export type BoxColliderHandle3D = ColliderHandle3D;
/** Handle returned by {@link useSphereCollider}. */
export type SphereColliderHandle3D = ColliderHandle3D;
/** Handle returned by {@link useCapsuleCollider}. */
export type CapsuleColliderHandle3D = ColliderHandle3D;

/**
 * Handle returned by {@link useMeshCollider}.
 *
 * Extends {@link ColliderHandle3D} with async lifecycle properties for
 * pre-baked BVH loading. When mesh data is provided synchronously,
 * `status` is immediately `'active'` and `ready` is already resolved.
 */
export interface MeshColliderHandle3D extends ColliderHandle3D {
  /** Current load state. `'active'` once the collider is live in Rapier. */
  status: 'loading' | 'active' | 'error';
  /**
   * Resolves when the collider becomes active in Rapier.
   * Already resolved when created from synchronous `vertices`/`indices` data.
   */
  ready: Promise<void>;
  /**
   * Cancel a pending async BVH load (e.g., when the actor is destroyed before
   * the collider becomes active). No-op when load already completed.
   */
  abort(): void;
  /**
   * Swap the collider geometry with new vertex and index data.
   *
   * Under the hood this:
   * 1. Sends `vertices` and `indices` to the BVH Web Worker (RFC-06c) for
   *    non-blocking construction.
   * 2. Once the Worker responds, calls `physics3d_rebuild_mesh_collider`
   *    on the WASM bridge, which removes the old collider and inserts the new
   *    trimesh atomically inside the Rapier3D world.
   *
   * @param vertices - New vertex positions `[x0,y0,z0, x1,y1,z1, ...]`.
   * @param indices  - New triangle indices `[a0,b0,c0, ...]`.
   * @returns A promise that resolves once the WASM swap is complete.
   * @throws If `physics3d_rebuild_mesh_collider` returns `false` (entity missing).
   */
  rebuild(vertices: Float32Array, indices: Uint32Array): Promise<void>;
}

/**
 * Options for {@link useMeshCollider}.
 *
 * Either provide `vertices` + `indices` for synchronous construction, or let
 * the `gwen:physics3d` Vite plugin populate `__bvhUrl` automatically from a
 * static GLB path string argument.
 */
export interface MeshColliderOptions {
  /**
   * Flat vertex position array `[x0,y0,z0, x1,y1,z1, ...]`.
   * Required unless `__bvhUrl` is set (pre-baked async path).
   */
  vertices?: Float32Array;
  /**
   * Flat triangle index array `[i0,i1,i2, ...]`.
   * Required unless `__bvhUrl` is set (pre-baked async path).
   */
  indices?: Uint32Array;
  /**
   * URL to a pre-baked BVH binary asset emitted at Vite build time.
   * Set automatically by the `gwen:physics3d` Vite plugin — do not write manually.
   * @internal
   */
  __bvhUrl?: string;
  /**
   * Fallback box collider dimensions active while the BVH loads asynchronously.
   * If omitted, no collision response until load completes.
   */
  placeholder?: { halfX: number; halfY: number; halfZ: number };
  /**
   * Set to `false` to force synchronous runtime BVH construction.
   * @default true
   */
  prebake?: boolean;
  /** Mark as sensor — generates events but no physical response. @default false */
  isSensor?: boolean;
  /** Numeric collision layer bitmask (membership). */
  layer?: number;
  /** Numeric collision filter bitmask (which layers to collide with). */
  mask?: number;
  /** Local-space X offset from the body origin. @default 0 */
  offsetX?: number;
  /** Local-space Y offset from the body origin. @default 0 */
  offsetY?: number;
  /** Local-space Z offset from the body origin. @default 0 */
  offsetZ?: number;
}

/** Handle returned by {@link useConvexCollider}. */
export type ConvexColliderHandle3D = ColliderHandle3D;

// ─── Compound collider ────────────────────────────────────────────────────────

/**
 * Specification for a single primitive shape within a compound collider.
 *
 * All offsets are in local body space (metres). `isSensor`, `friction`, and
 * `restitution` default to `false`, `0.5`, and `0.0` respectively when omitted.
 */
export type CompoundShapeSpec =
  | {
      type: 'box';
      /** Half-extent along the local X axis (metres). */
      halfX: number;
      /** Half-extent along the local Y axis (metres). */
      halfY: number;
      /** Half-extent along the local Z axis (metres). */
      halfZ: number;
      offsetX?: number;
      offsetY?: number;
      offsetZ?: number;
      isSensor?: boolean;
      friction?: number;
      restitution?: number;
    }
  | {
      type: 'sphere';
      radius: number;
      offsetX?: number;
      offsetY?: number;
      offsetZ?: number;
      isSensor?: boolean;
      friction?: number;
      restitution?: number;
    }
  | {
      type: 'capsule';
      radius: number;
      halfHeight: number;
      offsetX?: number;
      offsetY?: number;
      offsetZ?: number;
      isSensor?: boolean;
      friction?: number;
      restitution?: number;
    };

/**
 * Options for {@link useCompoundCollider}.
 *
 * At least one shape must be provided. `layers` and `mask` are shared across
 * all shapes in the compound body.
 */
export interface CompoundColliderOptions3D {
  /** Ordered list of primitive shapes to attach to the body. */
  shapes: CompoundShapeSpec[];
  /** Collision layer membership (named layers or numeric bitmask values). */
  layers?: (string | number)[];
  /** Collision filter — which layers this body collides with. */
  mask?: (string | number)[];
}

/**
 * Handle returned by {@link useCompoundCollider}.
 *
 * Holds stable IDs for every shape collider, in the same order as
 * `options.shapes`. Call `remove()` to detach all shapes at once.
 */
export interface CompoundColliderHandle3D {
  /** Stable numeric IDs for each shape collider, in `options.shapes` order. */
  readonly colliderIds: readonly number[];
  /** Remove all shapes of this compound collider from the entity. */
  remove(): void;
}

/** Handle returned by {@link useHeightfieldCollider}. */
export interface HeightfieldColliderHandle3D extends ColliderHandle3D {
  /**
   * Replace the height data of the collider.
   *
   * Rebuilds the underlying Rapier3D heightfield in-place using the same
   * grid dimensions and scale that were used at construction time.
   *
   * @param newHeights - Row-major flat array of `rows × cols` height values.
   *   Must have exactly the same length as the original heights array.
   */
  update(newHeights: Float32Array): void;
}

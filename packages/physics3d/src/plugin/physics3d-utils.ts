/**
 * @fileoverview Pure utility functions for physics3d plugin.
 * These functions are stateless and can be safely extracted and reused.
 */

import type {
  Physics3DVec3,
  Physics3DQuat,
  Physics3DBodyKind,
  Physics3DBodyState,
  Physics3DColliderOptions,
  Physics3DEntityId,
} from '../types';
import { PHYSICS3D_MATERIAL_PRESETS } from '../types';

/**
 * Construct a fully-initialized Physics3DVec3 from a partial override.
 * Defaults to zero vector when no overrides are provided.
 *
 * @param v - Partial vector overrides (optional fields use 0)
 * @returns Fully-initialized Physics3DVec3 with x, y, z components
 */
export function vec3(v?: Partial<Physics3DVec3>): Physics3DVec3 {
  return { x: v?.x ?? 0, y: v?.y ?? 0, z: v?.z ?? 0 };
}

/**
 * Construct a fully-initialized Physics3DQuat from a partial override.
 * Defaults to identity quaternion (0, 0, 0, 1) when no overrides are provided.
 *
 * @param v - Partial quaternion overrides (optional fields use identity values)
 * @returns Fully-initialized Physics3DQuat with x, y, z, w components
 */
export function quat(v?: Partial<Physics3DQuat>): Physics3DQuat {
  return { x: v?.x ?? 0, y: v?.y ?? 0, z: v?.z ?? 0, w: v?.w ?? 1 };
}

/**
 * Convert a Physics3DEntityId (bigint, number, or string) to the u32 entity slot
 * index used by WASM and as Map key. Always returns a plain number.
 *
 * @param entityId - Entity ID in any supported format
 * @returns Numeric slot index (0..2^32-1)
 */
export function toEntityIndex(entityId: Physics3DEntityId): number {
  if (typeof entityId === 'bigint') return Number(entityId & 0xffffffffn);
  if (typeof entityId === 'number') return entityId;
  return parseInt(entityId as string, 10);
}

/**
 * Map WASM body kind u8 (0=Fixed, 1=Dynamic, 2=Kinematic) to TypeScript string enum.
 *
 * @param k - WASM body kind byte (0, 1, 2, or invalid)
 * @returns TypeScript body kind string; defaults to 'dynamic' for unknown values
 */
export function kindFromU8(k: number): Physics3DBodyKind {
  if (k === 0) return 'fixed';
  if (k === 2) return 'kinematic';
  return 'dynamic';
}

/**
 * Map TypeScript body kind string to WASM u8 (0=Fixed, 1=Dynamic, 2=Kinematic).
 *
 * @param k - TypeScript body kind string
 * @returns WASM body kind byte
 */
export function kindToU8(k: Physics3DBodyKind): number {
  if (k === 'fixed') return 0;
  if (k === 'kinematic') return 2;
  return 1;
}

/**
 * Parse a 13-element Float32Array (physics3d_get_body_state layout) into a Physics3DBodyState.
 * Layout: [px, py, pz, qx, qy, qz, qw, vx, vy, vz, ax, ay, az]
 *
 * @param arr - Float32Array with at least 13 elements
 * @returns Parsed Physics3DBodyState with position, rotation, and velocities
 */
export function parseBodyState(arr: Float32Array): Physics3DBodyState {
  return {
    position: { x: arr[0] ?? 0, y: arr[1] ?? 0, z: arr[2] ?? 0 },
    rotation: { x: arr[3] ?? 0, y: arr[4] ?? 0, z: arr[5] ?? 0, w: arr[6] ?? 1 },
    linearVelocity: { x: arr[7] ?? 0, y: arr[8] ?? 0, z: arr[9] ?? 0 },
    angularVelocity: { x: arr[10] ?? 0, y: arr[11] ?? 0, z: arr[12] ?? 0 },
  };
}

/**
 * Deep-clone a Physics3DBodyState so snapshots are not aliased.
 * Recursively copies all vector and quaternion fields.
 *
 * @param s - Original body state
 * @returns Independent deep copy
 */
export function cloneState(s: Physics3DBodyState): Physics3DBodyState {
  return {
    position: { ...s.position },
    rotation: { ...s.rotation },
    linearVelocity: { ...s.linearVelocity },
    angularVelocity: { ...s.angularVelocity },
  };
}

/**
 * Resolve material preset defaults into explicit collider values.
 * Explicit options always win over the preset, and the preset always falls back to
 * PHYSICS3D_MATERIAL_PRESETS.default if not found.
 *
 * @param options - Collider options with optional materialPreset name
 * @returns Object with explicit friction, restitution, and density values
 */
export function resolveColliderMaterial(options: Physics3DColliderOptions): {
  friction: number;
  restitution: number;
  density: number;
} {
  const preset = options.materialPreset
    ? PHYSICS3D_MATERIAL_PRESETS[options.materialPreset]
    : PHYSICS3D_MATERIAL_PRESETS.default;

  return {
    friction: options.friction ?? preset.friction,
    restitution: options.restitution ?? preset.restitution,
    density: options.density ?? preset.density,
  };
}

/**
 * Compute local AABB (min/max) for a single collider given its body's position.
 * Collider offsets are applied before expanding by the shape half-extents.
 *
 * @param pos - Body world-space position
 * @param col - Collider options with shape and offsets
 * @returns LocalAABB with minX, maxX, minY, maxY, minZ, maxZ
 */
export interface LocalAABB {
  /** Minimum X extent */
  minX: number;
  /** Maximum X extent */
  maxX: number;
  /** Minimum Y extent */
  minY: number;
  /** Maximum Y extent */
  maxY: number;
  /** Minimum Z extent */
  minZ: number;
  /** Maximum Z extent */
  maxZ: number;
}

/**
 * Compute a world-space AABB for a single collider given its body's position.
 * Uses shape-specific half-extent calculations.
 *
 * @param pos - Body world position
 * @param col - Collider with shape type and offsets
 * @returns World-space AABB bounds
 */
export function computeColliderAABB(pos: Physics3DVec3, col: Physics3DColliderOptions): LocalAABB {
  const cx = pos.x + (col.offsetX ?? 0);
  const cy = pos.y + (col.offsetY ?? 0);
  const cz = pos.z + (col.offsetZ ?? 0);
  const shape = col.shape;

  let hx: number;
  let hy: number;
  let hz: number;

  if (shape.type === 'box') {
    hx = shape.halfX;
    hy = shape.halfY;
    hz = shape.halfZ;
  } else if (shape.type === 'sphere') {
    hx = shape.radius;
    hy = shape.radius;
    hz = shape.radius;
  } else if (shape.type === 'capsule') {
    // capsule: radius in X/Z, radius + halfHeight in Y
    hx = shape.radius;
    hy = shape.radius + shape.halfHeight;
    hz = shape.radius;
  } else if (shape.type === 'mesh' || shape.type === 'convex') {
    // Compute a tight AABB from the vertex array for accurate local-mode collision.
    // The vertices Float32Array contains interleaved (x, y, z) triples.
    const verts = shape.vertices;
    if (verts.length >= 3) {
      let minX = verts[0]!;
      let maxX = verts[0]!;
      let minY = verts[1]!;
      let maxY = verts[1]!;
      let minZ = verts[2]!;
      let maxZ = verts[2]!;
      for (let i = 3; i < verts.length; i += 3) {
        const vx = verts[i]!;
        const vy = verts[i + 1]!;
        const vz = verts[i + 2]!;
        if (vx < minX) minX = vx;
        if (vx > maxX) maxX = vx;
        if (vy < minY) minY = vy;
        if (vy > maxY) maxY = vy;
        if (vz < minZ) minZ = vz;
        if (vz > maxZ) maxZ = vz;
      }
      // Half-extents from the vertex bounds
      hx = (maxX - minX) / 2;
      hy = (maxY - minY) / 2;
      hz = (maxZ - minZ) / 2;
      // Offset centre by the mesh's own geometric centre
      const meshCx = cx + (minX + maxX) / 2;
      const meshCy = cy + (minY + maxY) / 2;
      const meshCz = cz + (minZ + maxZ) / 2;
      return {
        minX: meshCx - hx,
        maxX: meshCx + hx,
        minY: meshCy - hy,
        maxY: meshCy + hy,
        minZ: meshCz - hz,
        maxZ: meshCz + hz,
      };
    }
    // Fallback if no vertices: unit AABB
    hx = 0.5;
    hy = 0.5;
    hz = 0.5;
  } else {
    // heightfield and other shapes: conservative unit AABB
    hx = 0.5;
    hy = 0.5;
    hz = 0.5;
  }

  return {
    minX: cx - hx,
    maxX: cx + hx,
    minY: cy - hy,
    maxY: cy + hy,
    minZ: cz - hz,
    maxZ: cz + hz,
  };
}

/**
 * Check if two AABBs overlap on all three axes (inclusive comparison).
 * Uses separating axis theorem: AABBs overlap iff they overlap on X, Y, and Z axes.
 *
 * @param a - First AABB
 * @param b - Second AABB
 * @returns true if AABBs overlap in 3D space
 */
export function aabbOverlap(a: LocalAABB, b: LocalAABB): boolean {
  return (
    a.minX <= b.maxX &&
    a.maxX >= b.minX &&
    a.minY <= b.maxY &&
    a.maxY >= b.minY &&
    a.minZ <= b.maxZ &&
    a.maxZ >= b.minZ
  );
}

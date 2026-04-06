/**
 * @file helpers/compound.ts — pure encoding utilities for compound colliders.
 *
 * Converts an array of {@link CompoundShapeSpec} objects into the flat
 * `Float32Array` accepted by `physics3d_add_compound_collider`.
 */
import type { CompoundShapeSpec } from '../types';

/** Shape-type discriminant values — must match Rust `COMPOUND_SHAPE_*` constants. */
export const COMPOUND_SHAPE_BOX = 0;
export const COMPOUND_SHAPE_SPHERE = 1;
export const COMPOUND_SHAPE_CAPSULE = 2;

/** Number of `f32` values encoded per shape in the batch buffer. */
export const FLOATS_PER_COMPOUND_SHAPE = 12;

/**
 * Encode an ordered list of shape specs and their pre-assigned collider IDs
 * into a flat `Float32Array` for `physics3d_add_compound_collider`.
 *
 * Buffer layout per shape (12 floats):
 * ```
 * [shape_type, p0, p1, p2, p3(0), offsetX, offsetY, offsetZ,
 *  isSensor(0|1), friction, restitution, colliderId]
 * ```
 *
 * @param shapes      - Ordered array of shape specifications.
 * @param colliderIds - Stable IDs in the same order as `shapes`.
 * @returns Flat `Float32Array` ready to send to WASM.
 * @throws {Error} If `shapes.length !== colliderIds.length`.
 */
export function encodeCompoundShapes(
  shapes: CompoundShapeSpec[],
  colliderIds: number[],
): Float32Array {
  if (shapes.length !== colliderIds.length) {
    throw new Error(
      `[GWEN:compound] shapes.length (${shapes.length}) must equal colliderIds.length (${colliderIds.length})`,
    );
  }

  const buf = new Float32Array(shapes.length * FLOATS_PER_COMPOUND_SHAPE);

  shapes.forEach((shape, i) => {
    const base = i * FLOATS_PER_COMPOUND_SHAPE;
    const ox = shape.offsetX ?? 0;
    const oy = shape.offsetY ?? 0;
    const oz = shape.offsetZ ?? 0;
    const sensor = shape.isSensor ? 1.0 : 0.0;
    const friction = shape.friction ?? 0.5;
    const restitution = shape.restitution ?? 0.0;
    const id = colliderIds[i]!;

    switch (shape.type) {
      case 'box':
        buf[base + 0] = COMPOUND_SHAPE_BOX;
        buf[base + 1] = shape.halfX;
        buf[base + 2] = shape.halfY;
        buf[base + 3] = shape.halfZ;
        buf[base + 4] = 0; // p3 reserved
        break;
      case 'sphere':
        buf[base + 0] = COMPOUND_SHAPE_SPHERE;
        buf[base + 1] = shape.radius;
        buf[base + 2] = 0;
        buf[base + 3] = 0;
        buf[base + 4] = 0;
        break;
      case 'capsule':
        buf[base + 0] = COMPOUND_SHAPE_CAPSULE;
        buf[base + 1] = shape.radius;
        buf[base + 2] = shape.halfHeight;
        buf[base + 3] = 0;
        buf[base + 4] = 0;
        break;
    }

    buf[base + 5] = ox;
    buf[base + 6] = oy;
    buf[base + 7] = oz;
    buf[base + 8] = sensor;
    buf[base + 9] = friction;
    buf[base + 10] = restitution;
    buf[base + 11] = id;
  });

  return buf;
}

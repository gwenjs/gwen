import { FLAG_HAS_TRANSFORM, FLAG_TELEPORT } from "../hooks/wasm/shared-memory.js";
import type { TransformSample3D } from "@gwenjs/schema";
import type { RenderFrame2D } from "./transform-pair.js";

/**
 * The last two committed 3D history buffers.
 * Getters swap with the parity of the last successful commit. They do not call WASM.
 * Each slot is 12 floats: position xyz, quaternion xyzw, scale xyz, then flags.
 * The flags word is u32 index 10 (`shared-memory.ts` `FLAGS3D_OFFSET` is byte 40).
 */
export interface TransformPair3D {
  readonly previous: Float32Array;
  readonly current: Float32Array;
  readonly previousFlags: Uint32Array;
  readonly currentFlags: Uint32Array;
}

const SLOT_FLOATS = 12;
const FLAG_WORD = 10;

/**
 * Write the render pose of `slot` into `out`.
 * Returns false, and leaves `out` untouched, when `slot` is outside the pair
 * or the current slot has no 3D node.
 * A teleport flag, or a previous slot with no node, copies `current`.
 * Otherwise position and scale are lerped, and the quaternion is a normalised
 * lerp on the shorter arc.
 *
 * `frame.alpha` is read inside this function. Passing it as an argument boxes
 * a double on every call, and `read` must allocate nothing.
 */
export function readRenderPose3D(
  pair: TransformPair3D,
  slot: number,
  frame: RenderFrame2D,
  out: TransformSample3D,
): boolean {
  const current = pair.current;
  const slotCount = current.length / SLOT_FLOATS;
  if (!Number.isInteger(slot) || slot < 0 || slot >= slotCount) return false;
  const base = slot * SLOT_FLOATS;
  const currentFlags = pair.currentFlags[base + FLAG_WORD] ?? 0;
  if ((currentFlags & FLAG_HAS_TRANSFORM) === 0) return false;

  const previousFlags = pair.previousFlags[base + FLAG_WORD] ?? 0;
  const snapped =
    (currentFlags & FLAG_TELEPORT) !== 0 || (previousFlags & FLAG_HAS_TRANSFORM) === 0;
  const alpha = frame.rendering ? frame.alpha : 1;
  const factor = Number.isNaN(alpha) ? 1 : Math.min(1, Math.max(0, alpha));
  const curX = current[base] ?? 0;
  const curY = current[base + 1] ?? 0;
  const curZ = current[base + 2] ?? 0;
  const curQx = current[base + 3] ?? 0;
  const curQy = current[base + 4] ?? 0;
  const curQz = current[base + 5] ?? 0;
  const curQw = current[base + 6] ?? 0;
  const curSx = current[base + 7] ?? 0;
  const curSy = current[base + 8] ?? 0;
  const curSz = current[base + 9] ?? 0;
  if (snapped || factor === 1) {
    out.x = curX;
    out.y = curY;
    out.z = curZ;
    out.qx = curQx;
    out.qy = curQy;
    out.qz = curQz;
    out.qw = curQw;
    out.scaleX = curSx;
    out.scaleY = curSy;
    out.scaleZ = curSz;
    return true;
  }

  const previous = pair.previous;
  const prevX = previous[base] ?? 0;
  const prevY = previous[base + 1] ?? 0;
  const prevZ = previous[base + 2] ?? 0;
  const prevQx = previous[base + 3] ?? 0;
  const prevQy = previous[base + 4] ?? 0;
  const prevQz = previous[base + 5] ?? 0;
  const prevQw = previous[base + 6] ?? 0;
  const prevSx = previous[base + 7] ?? 0;
  const prevSy = previous[base + 8] ?? 0;
  const prevSz = previous[base + 9] ?? 0;
  if (factor === 0) {
    out.x = prevX;
    out.y = prevY;
    out.z = prevZ;
    out.qx = prevQx;
    out.qy = prevQy;
    out.qz = prevQz;
    out.qw = prevQw;
    out.scaleX = prevSx;
    out.scaleY = prevSy;
    out.scaleZ = prevSz;
    return true;
  }

  out.x = prevX + (curX - prevX) * factor;
  out.y = prevY + (curY - prevY) * factor;
  out.z = prevZ + (curZ - prevZ) * factor;
  out.scaleX = prevSx + (curSx - prevSx) * factor;
  out.scaleY = prevSy + (curSy - prevSy) * factor;
  out.scaleZ = prevSz + (curSz - prevSz) * factor;
  const dot = prevQx * curQx + prevQy * curQy + prevQz * curQz + prevQw * curQw;
  const sign = dot < 0 ? -1 : 1;
  const lx = prevQx + (sign * curQx - prevQx) * factor;
  const ly = prevQy + (sign * curQy - prevQy) * factor;
  const lz = prevQz + (sign * curQz - prevQz) * factor;
  const lw = prevQw + (sign * curQw - prevQw) * factor;
  // `Math.hypot` measured 24 bytes per entity per frame on `render.reader3d`.
  // The sum of squares does not.
  const length = Math.sqrt(lx * lx + ly * ly + lz * lz + lw * lw);
  const inverse = length === 0 ? 1 : 1 / length;
  out.qx = lx * inverse;
  out.qy = ly * inverse;
  out.qz = lz * inverse;
  out.qw = lw * inverse;
  return true;
}

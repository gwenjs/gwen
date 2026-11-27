import { wrapAngle } from "@gwenjs/math";

import { FLAG_HAS_TRANSFORM, FLAG_TELEPORT } from "../hooks/wasm/shared-memory.js";
import type { EngineFrame, EngineFrameInternal, GwenEngine } from "./engine-types.js";

/** Caller-owned sample. The helper writes these fields and allocates nothing. */
export interface InterpolatedTransform2D {
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
}

/**
 * The last two committed 2D history buffers.
 * Getters swap with the parity of the last successful commit. They do not call WASM.
 */
export interface TransformPair2D {
  readonly previous: Float32Array;
  readonly current: Float32Array;
  readonly previousFlags: Uint32Array;
  readonly currentFlags: Uint32Array;
}

const SLOT_FLOATS = 8;
const FLAG_WORD = 5;

/**
 * Write the interpolated 2D sample for `slot` into `out`.
 * Returns false, and leaves `out` untouched, when `slot` is outside the pair
 * or the current slot has no transform.
 * A teleport flag, or a previous slot with no transform, copies `current`.
 * `alpha` is clamped to `[0, 1]`. `NaN` becomes `1`.
 *
 * `destroyEntity` calls `delete_entity`, which removes the transform node. The next
 * commit skips the dead record, so this returns false. Renderers must drop an entity
 * on `entity:destroy`.
 */
export function readInterpolatedTransform2D(
  pair: TransformPair2D,
  slot: number,
  alpha: number,
  out: InterpolatedTransform2D,
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
  const factor = Number.isNaN(alpha) ? 1 : Math.min(1, Math.max(0, alpha));
  const curX = current[base] ?? 0;
  const curY = current[base + 1] ?? 0;
  const curRot = current[base + 2] ?? 0;
  const curSx = current[base + 3] ?? 0;
  const curSy = current[base + 4] ?? 0;
  if (snapped || factor === 1) {
    out.x = curX;
    out.y = curY;
    out.rotation = curRot;
    out.scaleX = curSx;
    out.scaleY = curSy;
    return true;
  }

  const previous = pair.previous;
  const prevX = previous[base] ?? 0;
  const prevY = previous[base + 1] ?? 0;
  const prevRot = previous[base + 2] ?? 0;
  const prevSx = previous[base + 3] ?? 0;
  const prevSy = previous[base + 4] ?? 0;
  if (factor === 0) {
    out.x = prevX;
    out.y = prevY;
    out.rotation = prevRot;
    out.scaleX = prevSx;
    out.scaleY = prevSy;
    return true;
  }
  out.x = prevX + (curX - prevX) * factor;
  out.y = prevY + (curY - prevY) * factor;
  out.rotation = prevRot + wrapAngle(curRot - prevRot) * factor;
  out.scaleX = prevSx + (curSx - prevSx) * factor;
  out.scaleY = prevSy + (curSy - prevSy) * factor;
  return true;
}

/** The two `EngineFrame` fields {@link readRenderPose2D} reads. */
export interface RenderFrame2D {
  readonly alpha: number;
  readonly rendering: boolean;
}

/**
 * Same result as {@link readInterpolatedTransform2D}, with the factor read from `frame`:
 * `frame.alpha` while `frame.rendering`, else `1` (the latest committed pose).
 *
 * The body is duplicated on purpose. `alpha` is read inside this function: passing
 * `frame.alpha` as an argument boxes a double on every call, and the `transform:2d`
 * reader must allocate nothing.
 */
export function readRenderPose2D(
  pair: TransformPair2D,
  slot: number,
  frame: RenderFrame2D,
  out: InterpolatedTransform2D,
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
  const curRot = current[base + 2] ?? 0;
  const curSx = current[base + 3] ?? 0;
  const curSy = current[base + 4] ?? 0;
  if (snapped || factor === 1) {
    out.x = curX;
    out.y = curY;
    out.rotation = curRot;
    out.scaleX = curSx;
    out.scaleY = curSy;
    return true;
  }

  const previous = pair.previous;
  const prevX = previous[base] ?? 0;
  const prevY = previous[base + 1] ?? 0;
  const prevRot = previous[base + 2] ?? 0;
  const prevSx = previous[base + 3] ?? 0;
  const prevSy = previous[base + 4] ?? 0;
  if (factor === 0) {
    out.x = prevX;
    out.y = prevY;
    out.rotation = prevRot;
    out.scaleX = prevSx;
    out.scaleY = prevSy;
    return true;
  }
  out.x = prevX + (curX - prevX) * factor;
  out.y = prevY + (curY - prevY) * factor;
  out.rotation = prevRot + wrapAngle(curRot - prevRot) * factor;
  out.scaleX = prevSx + (curSx - prevSx) * factor;
  out.scaleY = prevSy + (curSy - prevSy) * factor;
  return true;
}

function hasHistory(frame: EngineFrame): frame is EngineFrameInternal {
  return "transforms2D" in frame;
}

/**
 * The history pair `engine` published, for framework code and tests. `null` at `physicsHz: 0`,
 * before the fixed seed and after `stop()`. Game and plugin code reads `transform:2d` instead.
 * @internal
 */
export function transformPairOf(engine: Pick<GwenEngine, "frame">): TransformPair2D | null {
  const frame = engine.frame;
  return hasHistory(frame) ? frame.transforms2D : null;
}

import { describe, expect, it } from "vitest";

import {
  FLAG_TELEPORT,
  readInterpolatedTransform2D,
  type InterpolatedTransform2D,
  type TransformPair2D,
} from "../src/index.js";
import { FLAG_HAS_TRANSFORM } from "../src/hooks/wasm/shared-memory.js";

const SLOT_BYTES = 32;
const SLOT_FLOATS = 8;

function slotBuffer(slots: number): ArrayBuffer {
  return new ArrayBuffer(slots * SLOT_BYTES);
}

function writeSlot(
  buffer: ArrayBuffer,
  slot: number,
  x: number,
  y: number,
  rotation: number,
  scaleX: number,
  scaleY: number,
  flags: number,
): void {
  const floats = new Float32Array(buffer);
  const words = new Uint32Array(buffer);
  const base = slot * SLOT_FLOATS;
  floats[base] = x;
  floats[base + 1] = y;
  floats[base + 2] = rotation;
  floats[base + 3] = scaleX;
  floats[base + 4] = scaleY;
  words[base + 5] = flags;
}

function pairOf(previous: ArrayBuffer, current: ArrayBuffer): TransformPair2D {
  const previousFloats = new Float32Array(previous);
  const currentFloats = new Float32Array(current);
  const previousFlags = new Uint32Array(previous);
  const currentFlags = new Uint32Array(current);
  return {
    get previous() {
      return previousFloats;
    },
    get current() {
      return currentFloats;
    },
    get previousFlags() {
      return previousFlags;
    },
    get currentFlags() {
      return currentFlags;
    },
  };
}

function sample(): InterpolatedTransform2D {
  return { x: 42, y: 42, rotation: 42, scaleX: 42, scaleY: 42 };
}

describe("readInterpolatedTransform2D", () => {
  it("lerps position and scale and takes the short rotation arc", () => {
    const previous = slotBuffer(1);
    const current = slotBuffer(1);
    const prevRot = Math.PI - 0.1;
    const curRot = -Math.PI + 0.1;
    writeSlot(previous, 0, 0, 0, prevRot, 1, 2, FLAG_HAS_TRANSFORM);
    writeSlot(current, 0, 10, 4, curRot, 3, 6, FLAG_HAS_TRANSFORM);
    const out = sample();
    expect(readInterpolatedTransform2D(pairOf(previous, current), 0, 0.5, out)).toBe(true);
    expect(out.x).toBeCloseTo(5, 5);
    expect(out.y).toBeCloseTo(2, 5);
    expect(out.scaleX).toBeCloseTo(2, 5);
    expect(out.scaleY).toBeCloseTo(4, 5);
    expect(out.rotation).toBeCloseTo(Math.PI, 5);
  });

  it("snaps to current when the teleport bit is set", () => {
    const previous = slotBuffer(1);
    const current = slotBuffer(1);
    writeSlot(previous, 0, 0, 0, 0, 1, 1, FLAG_HAS_TRANSFORM);
    writeSlot(current, 0, 100, 0, 0, 1, 1, FLAG_HAS_TRANSFORM | FLAG_TELEPORT);
    const out = sample();
    expect(readInterpolatedTransform2D(pairOf(previous, current), 0, 0.5, out)).toBe(true);
    expect(out.x).toBe(100);
    expect(FLAG_TELEPORT).toBe(0b100);
  });

  it("snaps to current when the previous slot has no transform", () => {
    const previous = slotBuffer(1);
    const current = slotBuffer(1);
    writeSlot(current, 0, 7, 3, 0.2, 1, 1, FLAG_HAS_TRANSFORM);
    const out = sample();
    expect(readInterpolatedTransform2D(pairOf(previous, current), 0, 0.25, out)).toBe(true);
    expect(out.x).toBe(7);
    expect(out.y).toBe(3);
    expect(out.rotation).toBeCloseTo(0.2, 5);
  });

  it("returns false out of range and leaves the sample untouched", () => {
    const previous = slotBuffer(2);
    const current = slotBuffer(2);
    writeSlot(previous, 0, 1, 1, 0, 1, 1, FLAG_HAS_TRANSFORM);
    writeSlot(current, 0, 3, 1, 0, 1, 1, FLAG_HAS_TRANSFORM);
    const out = sample();
    expect(readInterpolatedTransform2D(pairOf(previous, current), -1, 0.5, out)).toBe(false);
    expect(readInterpolatedTransform2D(pairOf(previous, current), 2, 0.5, out)).toBe(false);
    expect(readInterpolatedTransform2D(pairOf(previous, current), 0.5, 0.5, out)).toBe(false);
    expect(out).toEqual({ x: 42, y: 42, rotation: 42, scaleX: 42, scaleY: 42 });
  });

  it("returns false when the current slot has no transform and leaves the sample untouched", () => {
    const previous = slotBuffer(1);
    const current = slotBuffer(1);
    writeSlot(previous, 0, 1, 0, 0, 1, 1, FLAG_HAS_TRANSFORM);
    const out = sample();
    expect(readInterpolatedTransform2D(pairOf(previous, current), 0, 0.5, out)).toBe(false);
    expect(out.x).toBe(42);
  });

  it("clamps alpha and treats NaN as 1", () => {
    const previous = slotBuffer(1);
    const current = slotBuffer(1);
    writeSlot(previous, 0, 0, 0, 0, 1, 1, FLAG_HAS_TRANSFORM);
    writeSlot(current, 0, 10, 0, 0, 1, 1, FLAG_HAS_TRANSFORM);
    const pair = pairOf(previous, current);
    const high = sample();
    const low = sample();
    const nan = sample();
    expect(readInterpolatedTransform2D(pair, 0, 2, high)).toBe(true);
    expect(readInterpolatedTransform2D(pair, 0, -1, low)).toBe(true);
    expect(readInterpolatedTransform2D(pair, 0, Number.NaN, nan)).toBe(true);
    expect(high.x).toBe(10);
    expect(low.x).toBe(0);
    expect(nan.x).toBe(10);
  });
});

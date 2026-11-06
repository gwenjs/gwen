/**
 * Named collision layers. Error code strings are chosen by the caller.
 */

import type { LayerSelector } from "./types.js";

/** Maximum collision layers. A u32 mask has 32 bits. */
export const MAX_LAYERS = 32;

/** Mask with every layer bit set. */
export const LAYER_ALL = 0xffffffff;

/**
 * Codes passed to `LayerRegistry`'s `onError`.
 * They carry no dimension prefix. The dimension package maps them onto its own codes.
 */
export const LAYER_ERROR_CODES = {
  LAYER_LIMIT: "LAYER_LIMIT",
  LAYER_UNKNOWN: "LAYER_UNKNOWN",
  LAYER_BIT_RANGE: "LAYER_BIT_RANGE",
} as const;

/**
 * Resolves layer names to a u32 mask.
 * Constructed once per plugin. `onError` throws the caller's error.
 */
export class LayerRegistry {
  private readonly bits: Record<string, number>;
  private readonly onError: (code: string, what: string) => never;

  constructor(layers: Record<string, number>, onError: (code: string, what: string) => never) {
    this.onError = onError;
    const names = Object.keys(layers);
    if (names.length > MAX_LAYERS) {
      onError(
        LAYER_ERROR_CODES.LAYER_LIMIT,
        `A layer registry accepts at most ${MAX_LAYERS} layers, received ${names.length}.`,
      );
    }
    for (const name of names) {
      const bit = layers[name];
      if (bit === undefined || !Number.isInteger(bit) || bit < 0 || bit > MAX_LAYERS - 1) {
        onError(
          LAYER_ERROR_CODES.LAYER_BIT_RANGE,
          `Layer "${name}" bit ${String(bit)} is outside 0..${MAX_LAYERS - 1}.`,
        );
      }
    }
    this.bits = layers;
  }

  /**
   * Resolve `sel` to a mask.
   * A name becomes `1 << bit`. A number is kept. An array is OR-ed.
   */
  resolve(sel: LayerSelector, role: string): number {
    if (typeof sel === "number") return sel >>> 0;
    if (typeof sel === "string") return this.maskOf(sel, role);
    return this.resolveList(sel, role);
  }

  private maskOf(name: string, role: string): number {
    const bit = this.bits[name];
    if (bit === undefined) return this.unknown(name, role);
    return (1 << bit) >>> 0;
  }

  private unknown(name: string, role: string): never {
    const known = Object.keys(this.bits).join(", ");
    this.onError(
      LAYER_ERROR_CODES.LAYER_UNKNOWN,
      `Unknown layer "${name}" in ${role}. Declared layers: [${known}].`,
    );
  }

  private resolveList(items: readonly (string | number)[], role: string): number {
    let mask = 0;
    for (const item of items) {
      mask |= typeof item === "number" ? item >>> 0 : this.maskOf(item, role);
    }
    return mask >>> 0;
  }
}

/**
 * Declares named layers. Returns the same object.
 * Warns when two values share a bit. The build plugin may inline the values later.
 */
export function defineLayers<T extends Record<string, number>>(
  definition: T,
): { [K in keyof T]: number } {
  const values = Object.values(definition);
  for (let i = 0; i < values.length; i += 1) {
    for (let j = i + 1; j < values.length; j += 1) {
      const left = values[i];
      const right = values[j];
      if (left === undefined || right === undefined || (left & right) === 0) continue;
      console.warn(
        `[gwen:physics-core] defineLayers: layers at index ${i} and ${j} share bits (${left} & ${right} = ${left & right}).`,
      );
    }
  }
  return definition;
}

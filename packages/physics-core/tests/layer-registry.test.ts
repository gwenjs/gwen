/**
 * Layer masks. Names become bits, numbers stay raw, arrays are OR-ed.
 */

import { describe, expect, it } from "vitest";
import * as api from "../src/index.js";

class LayerFailure extends Error {
  readonly code: string;

  constructor(code: string, what: string) {
    super(what);
    this.name = "LayerFailure";
    this.code = code;
  }
}

function failLayer(code: string, what: string): never {
  throw new LayerFailure(code, what);
}

function thrown(body: () => void): LayerFailure {
  try {
    body();
  } catch (error) {
    expect(error).toBeInstanceOf(LayerFailure);
    if (error instanceof LayerFailure) return error;
  }
  throw new Error("expected LayerFailure");
}

function namedLayers(count: number): Record<string, number> {
  const layers: Record<string, number> = {};
  for (let bit = 0; bit < count; bit += 1) {
    layers[`l${bit}`] = bit;
  }
  return layers;
}

describe("LayerRegistry", () => {
  it("throws past 32 layers", () => {
    expect(typeof api.LayerRegistry).toBe("function");
    const full = new api.LayerRegistry(namedLayers(32), failLayer);
    expect(full.resolve("l0", "membership")).toBe(1);
    const error = thrown(() => new api.LayerRegistry(namedLayers(33), failLayer));
    expect(error.code).toBe(api.LAYER_ERROR_CODES.LAYER_LIMIT);
    expect(error.message).toBe("A layer registry accepts at most 32 layers, received 33.");
  });

  it("unknown name throws through onError", () => {
    expect(typeof api.LayerRegistry).toBe("function");
    const registry = new api.LayerRegistry({ ground: 0 }, failLayer);
    const error = thrown(() => registry.resolve("missing", "membership"));
    expect(error.code).toBe(api.LAYER_ERROR_CODES.LAYER_UNKNOWN);
    expect(error.message).toBe('Unknown layer "missing" in membership. Declared layers: [ground].');
  });

  it("bit index out of range throws", () => {
    expect(typeof api.LayerRegistry).toBe("function");
    const high = thrown(() => new api.LayerRegistry({ high: 32 }, failLayer));
    expect(high.code).toBe(api.LAYER_ERROR_CODES.LAYER_BIT_RANGE);
    expect(high.message).toBe('Layer "high" bit 32 is outside 0..31.');
    const low = thrown(() => new api.LayerRegistry({ low: -1 }, failLayer));
    expect(low.code).toBe(api.LAYER_ERROR_CODES.LAYER_BIT_RANGE);
    expect(low.message).toBe('Layer "low" bit -1 is outside 0..31.');
    const top = new api.LayerRegistry({ top: 31 }, failLayer);
    expect(top.resolve("top", "membership")).toBe(2147483648);
  });

  it("resolves a name, a number and a mixed array", () => {
    expect(typeof api.LayerRegistry).toBe("function");
    const empty = new api.LayerRegistry({}, failLayer);
    expect(empty.resolve(3, "mask")).toBe(3);
    expect(empty.resolve([], "mask")).toBe(0);
    const one = new api.LayerRegistry({ only: 0 }, failLayer);
    expect(one.resolve("only", "membership")).toBe(1);
    const registry = new api.LayerRegistry({ ground: 0, shelf: 3 }, failLayer);
    expect(registry.resolve("shelf", "membership")).toBe(8);
    expect(registry.resolve(7, "mask")).toBe(7);
    expect(registry.resolve(["ground", 4], "membership")).toBe(5);
    const full = new api.LayerRegistry(namedLayers(32), failLayer);
    expect(full.resolve("l31", "membership")).toBe(2147483648);
  });
});

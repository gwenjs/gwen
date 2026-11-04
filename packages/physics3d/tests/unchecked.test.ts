import { describe, expect, it } from "vitest";
import { liveWasmBridge, uncheckedAt } from "../src/internal/unchecked";
import type { Physics3DWasmBridge } from "../src/plugin/bridge";

describe("uncheckedAt", () => {
  it("reads an element of an array at its index", () => {
    expect(uncheckedAt(["a", "b", "c"], 2)).toBe("c");
  });

  it("reads an element of a typed array at its index", () => {
    expect(uncheckedAt(new Float32Array([1.5, 2.5, 3.5]), 1)).toBe(2.5);
  });

  it("does not check the bound: an index past the end reads undefined and does not throw", () => {
    expect(uncheckedAt([1, 2], 2)).toBeUndefined();
  });
});

describe("liveWasmBridge", () => {
  it("returns the very bridge it is given, so exports keep their receiver", () => {
    const bridge: Physics3DWasmBridge = {
      physics3d_has_body(this: Physics3DWasmBridge) {
        return this === bridge;
      },
    };
    expect(liveWasmBridge(bridge)).toBe(bridge);
    expect(liveWasmBridge(bridge).physics3d_has_body(0)).toBe(true);
  });

  it("keeps the failure of a missing bridge: the first export read throws a TypeError", () => {
    expect(() => liveWasmBridge(null).physics3d_has_body).toThrow(TypeError);
  });
});

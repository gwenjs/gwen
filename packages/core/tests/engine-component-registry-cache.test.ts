/**
 * Lane mapping for EngineComponentRegistry.
 * The per-entity type cache is gone: component membership lives in the WASM rows.
 */

import { describe, it, expect } from "vitest";
import { GwenError } from "@gwenjs/schema";
import { EngineComponentRegistry } from "../src/engine/engine-component-registry";
import { CoreErrorCodes } from "../src/engine/engine-errors";
import type { WasmBridge } from "../src/engine/wasm-bridge";
import { Types } from "../src/schema";

describe("EngineComponentRegistry lanes", () => {
  function recordingBridge(): { bridge: WasmBridge; seen: number[][] } {
    const seen: number[][] = [];
    const recorded = {
      isActive: () => true,
      registerComponent: (lanes: Uint8Array) => {
        seen.push(Array.from(lanes));
        return seen.length;
      },
      hasComponent: (_index: number, _generation: number, _typeId: number) => false,
    };
    const bridge = recorded as WasmBridge;
    return { bridge, seen };
  }

  it("maps each Types entry and a string name onto lane kinds", () => {
    const { bridge, seen } = recordingBridge();
    const registry = new EngineComponentRegistry(bridge);
    const cases = [
      { field: Types.f32, lanes: [0] },
      { field: Types.f64, lanes: [1] },
      { field: Types.i32, lanes: [2] },
      { field: Types.u32, lanes: [3] },
      { field: Types.bool, lanes: [4] },
      { field: Types.i64, lanes: [5] },
      { field: Types.u64, lanes: [6] },
      { field: Types.string, lanes: [7] },
      { field: Types.persistentString, lanes: [7] },
      { field: Types.vec2, lanes: [0, 0] },
      { field: Types.vec3, lanes: [0, 0, 0] },
      { field: Types.vec4, lanes: [0, 0, 0, 0] },
      { field: Types.quat, lanes: [0, 0, 0, 0] },
      { field: Types.color, lanes: [0, 0, 0, 0] },
    ];
    registry.getOrRegister("Transform");
    for (const [index, item] of cases.entries()) {
      registry.getOrRegister({ name: `Lane${index}`, schema: { value: item.field } });
    }
    registry.getOrRegister({
      name: "Ordered",
      schema: { y: Types.f32, flag: Types.bool },
    });
    expect(seen).toEqual([[0], ...cases.map((item) => item.lanes), [0, 4]]);
  });

  it("rejects the same name when the lanes differ and keeps the first id", () => {
    const { bridge, seen } = recordingBridge();
    const registry = new EngineComponentRegistry(bridge);
    const first = registry.getOrRegister({ name: "Same", schema: { a: Types.f32 } });
    let caught: unknown;
    try {
      registry.getOrRegister({ name: "Same", schema: { a: Types.f64 } });
    } catch (error: unknown) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(GwenError);
    if (!(caught instanceof GwenError)) {
      throw new Error("expected GwenError");
    }
    expect(caught.code).toBe(CoreErrorCodes.COMPONENT_LAYOUT_INVALID);
    expect(registry.get("Same")).toBe(first);
    expect(seen).toEqual([[0]]);
  });
});

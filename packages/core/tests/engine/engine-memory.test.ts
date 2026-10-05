import { describe, expect, it } from "vitest";
import { GwenError } from "@gwenjs/schema";

import { CoreErrorCodes, createEngine, createErrorBus } from "../../src/index.js";
import { EngineMemory } from "../../src/engine/engine-memory.js";
import { WasmBridgeImpl } from "../../src/engine/wasm-bridge.js";

function harness(): { memory: WebAssembly.Memory; views: EngineMemory } {
  const memory = new WebAssembly.Memory({ initial: 1 });
  const bridge = new WasmBridgeImpl();
  bridge._injectMockExports({ memory });
  bridge._captureMemoryBaseline();
  return { memory, views: new EngineMemory(bridge, createErrorBus()) };
}

describe("EngineMemory", () => {
  it("is the same object as inject('memory') and starts at epoch 0", async () => {
    const engine = await createEngine();
    expect(engine.memory.epoch).toBe(0);
    expect(engine.inject("memory")).toBe(engine.memory);
  });

  it("returns the same array until the buffer detaches", () => {
    const { memory, views } = harness();
    const view = views.view({
      name: "test:bytes",
      type: "u8",
      ptr: () => 0,
      length: () => 4,
    });
    const first = view.array;
    first[0] = 9;
    expect(view.array).toBe(first);
    expect(view.epoch).toBe(0);

    memory.grow(1);
    expect(first.byteLength).toBe(0);
    const rebuilt = view.array;
    expect(rebuilt.byteLength).toBe(4);
    expect(rebuilt[0]).toBe(9);
    expect(view.epoch).toBe(0);
  });

  it("rejects every invalid view", () => {
    const { views } = harness();
    views.view({ name: "test:bytes", type: "u8", ptr: () => 0, length: () => 4 });
    expect(() =>
      views.view({ name: "test:bytes", type: "u8", ptr: () => 0, length: () => 4 }),
    ).toThrow(GwenError);

    const zero = views.view({ name: "test:zero", type: "u8", ptr: () => 0, length: () => 0 });
    expect(() => zero.array).toThrow(GwenError);

    const oob = views.view({
      name: "test:oob",
      type: "u8",
      ptr: () => 1_000_000,
      length: () => 4,
    });
    expect(() => oob.array).toThrow(GwenError);

    const skewed = views.view({ name: "test:skew", type: "f32", ptr: () => 1, length: () => 1 });
    expect(() => skewed.array).toThrow(GwenError);

    const bare = new EngineMemory(new WasmBridgeImpl(), createErrorBus());
    const missing = bare.view({ name: "test:none", type: "u8", ptr: () => 0, length: () => 4 });
    expect(() => missing.array).toThrow(GwenError);

    let caught: unknown;
    try {
      caught = zero.array;
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(GwenError);
    expect((caught as GwenError).code).toBe(CoreErrorCodes.MEMORY_VIEW_INVALID);
    expect((caught as GwenError).message).toContain("test:zero");
  });

  it("throws after dispose and after the engine stops", () => {
    const { views } = harness();
    const view = views.view({ name: "test:bytes", type: "u8", ptr: () => 0, length: () => 4 });
    expect(view.array.byteLength).toBeGreaterThan(0);
    view.dispose();
    expect(() => view.array).toThrow(/used after dispose/);

    const stopped = views.view({ name: "test:later", type: "u8", ptr: () => 0, length: () => 4 });
    expect(stopped.array.byteLength).toBeGreaterThan(0);
    views.disposeAll();
    expect(() => stopped.array).toThrow(/engine stopped/);
  });
});

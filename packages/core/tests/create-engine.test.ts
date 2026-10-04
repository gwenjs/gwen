/**
 * RFC-001: createEngine() acceptance tests
 */
import { describe, it, expect } from "vitest";
import { createEngine, GwenConfigError } from "../src/index";

describe("createEngine", () => {
  it("returns a GwenEngine (not {engine, scenes})", async () => {
    const engine = await createEngine();
    expect(engine).toBeDefined();
    expect(typeof engine.use).toBe("function");
    expect(typeof engine.unuse).toBe("function");
    expect(typeof engine.inject).toBe("function");
    expect(typeof engine.tryInject).toBe("function");
    expect(typeof engine.provide).toBe("function");
    expect(typeof engine.advance).toBe("function");
  });

  it("applies default options", async () => {
    const engine = await createEngine();
    expect(engine.maxEntities).toBe(10_000);
    expect(engine.targetFPS).toBe(60);
    expect(engine.maxDeltaSeconds).toBe(0.1);
    expect(engine.variant).toBe("light");
  });

  it("applies custom options", async () => {
    const engine = await createEngine({ maxEntities: 500, targetFPS: 30, maxDeltaSeconds: 0.05 });
    expect(engine.maxEntities).toBe(500);
    expect(engine.targetFPS).toBe(30);
    expect(engine.maxDeltaSeconds).toBe(0.05);
  });

  it("rejects with GwenConfigError on invalid maxEntities", async () => {
    await expect(createEngine({ maxEntities: -1 })).rejects.toThrow(GwenConfigError);
  });

  it("accepts an explicit bridge instance via _bridge option", async () => {
    const { WasmBridgeImpl } = await import("../src/engine/wasm-bridge");
    const bridge = new WasmBridgeImpl();
    const engine = await createEngine({ _bridge: bridge });
    expect(engine).toBeDefined();
    // Verify the engine is using the injected bridge
    expect((engine as any)._bridge).toBe(bridge);
  });
});

import { describe, it, expect } from "vitest";
import { createEngine } from "../src/index.js";

describe("removed public surface (#109 step 2)", () => {
  it("has no wasmBridge and a debug frame has no phaseMs.physics", async () => {
    const engine = await createEngine({ debug: true });
    try {
      await engine.startExternal();
      await engine.advance(1 / 60);
      const phaseMs = engine.getStats().phaseMs;
      if (phaseMs !== undefined) {
        expect("physics" in phaseMs).toBe(false);
      }
      expect("wasmBridge" in engine).toBe(false);
    } finally {
      await engine.stop();
    }
  });

  it("a second engine also has no wasmBridge", async () => {
    const first = await createEngine();
    const second = await createEngine();
    try {
      expect("wasmBridge" in first).toBe(false);
      expect("wasmBridge" in second).toBe(false);
    } finally {
      await first.stop();
      await second.stop();
    }
  });
});

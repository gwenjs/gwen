import { describe, expect, it } from "vitest";

import { createRealEngine } from "./harness.js";

function historyPointer(engine: object, buffer: number): number {
  if (!("engine" in engine) || typeof engine.engine !== "function") return 0;
  const wasm: unknown = engine.engine();
  if (typeof wasm !== "object" || wasm === null || !("transform_history_ptr" in wasm)) return 0;
  const read = wasm.transform_history_ptr;
  if (typeof read !== "function") return 0;
  const value: unknown = read.call(wasm, buffer);
  return typeof value === "number" ? value : 0;
}

describe("fixed-step advance on real wasm", () => {
  it("seeds both history buffers before the first advance", async () => {
    const handle = await createRealEngine({
      variant: "light",
      maxEntities: 32,
      physicsHz: 60,
    });
    try {
      await handle.engine.startExternal();
      expect(historyPointer(handle.bridge, 0)).not.toBe(0);
      expect(historyPointer(handle.bridge, 1)).not.toBe(0);
    } finally {
      await handle.dispose();
    }
  });

  it("keeps one step per exact advance across 600 frames", async () => {
    const handle = await createRealEngine({
      variant: "light",
      maxEntities: 32,
      physicsHz: 60,
    });
    try {
      let afterTicks = 0;
      const alphas: number[] = [];
      handle.engine.hooks.hook("engine:afterTick", () => {
        afterTicks += 1;
      });
      handle.engine.hooks.hook("engine:render", (alpha?: number) => {
        alphas.push(alpha ?? Number.NaN);
      });
      await handle.advance(600, 1 / 60);
      expect(alphas).toHaveLength(600);
      expect(alphas[599]).toBe(0);
      expect(handle.engine.frameCount).toBe(600);
      expect(afterTicks).toBe(600);
    } finally {
      await handle.dispose();
    }
  });
});

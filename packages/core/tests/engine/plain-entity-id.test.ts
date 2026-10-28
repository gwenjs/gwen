/**
 * createEntity returns a plain { index, generation } and frees the glue wrapper.
 */
import { describe, expect, it } from "vitest";

import { createEngine } from "../../src/index.js";

describe("plain entity id", () => {
  it("WasmBridge.createEntity returns a plain object without free", async () => {
    const engine = await createEngine();
    try {
      const id = engine.inject("wasm:bridge").createEntity();
      expect(Object.getPrototypeOf(id) === Object.prototype).toBe(true);
      expect("free" in id).toBe(false);
    } finally {
      await engine.stop();
    }
  });
});

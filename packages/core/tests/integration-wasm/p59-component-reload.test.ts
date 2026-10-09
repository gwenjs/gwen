/**
 * A component redefined under the same name (hot reload) on a real WASM engine.
 */
import { describe, expect, it } from "vitest";
import { defineComponent, Types } from "../../src/index.js";
import { createRealEngine } from "./harness.js";

describe("real engine component redefinition", () => {
  it("writes through a redefined component into the same type", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 8 });
    try {
      const engine = handle.engine;
      const First = defineComponent({ name: "P59Reload", schema: { v: Types.f32 } });
      const first = engine.createEntity();
      engine.addComponent(first, First, { v: 1 });
      const Second = defineComponent({ name: "P59Reload", schema: { v: Types.f32 } });
      const second = engine.createEntity();
      engine.addComponent(second, Second, { v: 2 });
      expect(engine.hasComponent(first, Second)).toBe(true);
      expect(engine.hasComponent(second, First)).toBe(true);
      expect(engine.getComponent(second, First)?.v).toBe(2);
      expect(engine.registeredComponentTypes().size).toBe(1);
    } finally {
      await handle.dispose();
    }
  });
});

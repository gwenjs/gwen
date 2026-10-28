import { describe, expect, it } from "vitest";

import { createRealEngine } from "./harness.js";

describe("release_component", () => {
  it("frees an unused type id and refuses a type that still has rows", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 4 });
    const engine = handle.bridge.engine();
    try {
      expect(typeof engine.release_component).toBe("function");

      const ids: number[] = [];
      for (let index = 0; index < 128; index += 1) {
        ids.push(engine.register_component(new Uint8Array([0])));
      }
      const busy = ids[3];
      if (busy === undefined) {
        throw new Error("expected type 3");
      }
      const entity = engine.create_entity();
      const bytes = new Uint8Array([1, 0, 0, 0]);
      expect(engine.add_component(entity.index, entity.generation, busy, bytes)).toBe(true);

      let caught: unknown;
      try {
        engine.release_component(busy);
      } catch (error: unknown) {
        caught = error;
      }
      expect(caught).toMatchObject({ code: "CORE:COMPONENT_TYPE_IN_USE" });
      expect(Array.from(engine.get_component_raw(entity.index, entity.generation, busy))).toEqual([
        1, 0, 0, 0,
      ]);

      expect(engine.delete_entity(entity.index, entity.generation)).toBe(true);
      engine.release_component(busy);
      expect(engine.register_component(new Uint8Array([0]))).toBe(busy);
    } finally {
      await handle.dispose();
    }
  });

  it("reads a released type id as unregistered until it is reused", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 4 });
    const engine = handle.bridge.engine();
    try {
      const typeId = engine.register_component(new Uint8Array([0]));
      engine.release_component(typeId);

      const entity = engine.create_entity();
      let caught: unknown;
      try {
        engine.add_component(entity.index, entity.generation, typeId, new Uint8Array(0));
      } catch (error: unknown) {
        caught = error;
      }
      expect(caught).toMatchObject({ code: "CORE:COMPONENT_LAYOUT_INVALID" });
      expect(engine.has_component(entity.index, entity.generation, typeId)).toBe(false);
    } finally {
      await handle.dispose();
    }
  });
});

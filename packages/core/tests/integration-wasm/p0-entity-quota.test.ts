import { describe, expect, it } from "vitest";

import { GwenError } from "@gwenjs/schema";

import { CoreErrorCodes, GwenWasmError } from "../../src/index.js";
import { createRealEngine } from "./harness.js";

describe("P0 entity quota", () => {
  it("D7 entity quota: the extra create is a recoverable limit error", async () => {
    const maxEntities = 4;
    const handle = await createRealEngine({
      variant: "light",
      maxEntities,
    });
    try {
      const { engine, bridge } = handle;
      let caught: unknown;
      try {
        for (let n = 0; n < maxEntities + 1; n += 1) {
          bridge.createEntity();
        }
      } catch (error: unknown) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(GwenWasmError);
      expect(caught).toBeInstanceOf(GwenError);
      expect((caught as GwenError).code).toBe("CORE:ENTITY_LIMIT_REACHED");
      expect(caught).toMatchObject({
        code: CoreErrorCodes.ENTITY_LIMIT_REACHED,
        exportName: "create_entity",
      });
      expect((caught as GwenWasmError).message).toContain(String(maxEntities));
      expect(bridge.countEntities()).toBe(maxEntities);
      expect(bridge.isAlive(0, 0)).toBe(true);
      const before = engine.frameCount;
      await engine.advance(1 / 60);
      expect(engine.frameCount).toBe(before + 1);
      expect(engine.state).not.toBe("faulted");
    } finally {
      await handle.dispose();
    }
  });

  it("bulk spawn over the quota is a typed error and writes nothing", async () => {
    const handle = await createRealEngine({
      variant: "light",
      maxEntities: 100,
    });
    try {
      const { engine, bridge } = handle;
      const positions = new Float32Array(150 * 2);
      const rotations = new Float32Array(150);

      let caught: unknown;
      try {
        bridge.bulkSpawnWithTransforms(positions, rotations);
      } catch (error: unknown) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(GwenWasmError);
      expect(caught).toBeInstanceOf(GwenError);
      expect((caught as GwenError).code).toBe("CORE:ENTITY_LIMIT_REACHED");
      expect(caught).toMatchObject({
        code: CoreErrorCodes.ENTITY_LIMIT_REACHED,
        exportName: "bulk_spawn_with_transforms",
      });
      expect(bridge.countEntities()).toBe(0);
      expect((caught as GwenWasmError).message).toContain("100");
      const before = engine.frameCount;
      await engine.advance(1 / 60);
      expect(engine.frameCount).toBe(before + 1);
      expect(engine.state).not.toBe("faulted");

      const created = bridge.createEntity();
      expect(bridge.isAlive(created.index, created.generation)).toBe(true);
      expect(bridge.countEntities()).toBe(1);
    } finally {
      await handle.dispose();
    }
  });
});

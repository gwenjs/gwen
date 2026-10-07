import { describe, expect, it } from "vitest";

import { GwenError } from "@gwenjs/schema";

import { CoreErrorCodes, GwenWasmError, GwenWasmPanicError } from "../../src/engine/engine-errors";
import { EngineComponentRegistry } from "../../src/engine/engine-component-registry";
import { defineComponent, Types } from "../../src/schema";
import { createRealEngine } from "./harness.js";

const TRANSFORM_TYPE_ID = 0xffffffff - 1;

describe("component type budget", () => {
  it("127 user types and the transform accept writes in WASM; the 128th name throws in defineComponent", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 4 });
    let caught: unknown;
    try {
      const defs = [];
      for (let i = 1; i <= 127; i += 1) {
        defs.push(
          defineComponent({
            name: `WithTransform${i}`,
            schema: { v: Types.f32 },
          }),
        );
      }
      const entity = handle.bridge.createEntity();
      const bytes = new Uint8Array([1, 0, 0, 0]);
      for (const def of defs) {
        expect(
          handle.bridge.addComponent(entity.index, entity.generation, def._typeId, bytes),
        ).toBe(true);
      }
      expect(
        handle.bridge.addComponent(entity.index, entity.generation, TRANSFORM_TYPE_ID, bytes),
      ).toBe(true);

      defineComponent({ name: "WithTransform128", schema: { v: Types.f32 } });
    } catch (error: unknown) {
      caught = error;
    } finally {
      await handle.dispose();
    }

    expect(caught).toBeInstanceOf(GwenError);
    expect(caught).not.toBeInstanceOf(GwenWasmError);
    expect(caught).not.toBeInstanceOf(GwenWasmPanicError);
    if (!(caught instanceof GwenError)) {
      throw new Error("expected GwenError");
    }
    expect(caught.code).toBe(CoreErrorCodes.COMPONENT_TYPE_LIMIT_REACHED);
    expect(caught.message).toContain("128");
    expect(caught.name).toBe("GwenError");
  });

  it("the registry rejects its 128th name before registerComponentType", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 4 });
    const registry = new EngineComponentRegistry(handle.bridge);
    let caught: unknown;
    let nextBridgeId = -1;
    try {
      for (let i = 1; i <= 128; i += 1) {
        registry.getOrRegister(`Reg${i}`);
      }
    } catch (error: unknown) {
      caught = error;
    } finally {
      // The WASM counter behind registerComponentType: one more id per call.
      nextBridgeId = handle.bridge.registerComponentType();
      await handle.dispose();
    }

    const firstId = registry.get("Reg1");
    expect(firstId).toEqual(expect.any(Number));
    expect(nextBridgeId - (firstId ?? 0)).toBe(127);
    expect(caught).toBeInstanceOf(GwenError);
    expect(caught).not.toBeInstanceOf(GwenWasmError);
    expect(caught).not.toBeInstanceOf(GwenWasmPanicError);
    if (!(caught instanceof GwenError)) {
      throw new Error("expected GwenError");
    }
    expect(caught.code).toBe(CoreErrorCodes.COMPONENT_TYPE_LIMIT_REACHED);
    expect(caught.message).toContain("127");
    expect(caught.message).toContain("128");
    expect(registry.get("Reg128")).toBeUndefined();
    expect(registry.get("Reg127")).toEqual(expect.any(Number));
  });
});

import { describe, expect, it } from "vitest";

import { GwenError } from "@gwenjs/schema";

import { CoreErrorCodes, GwenWasmError, GwenWasmPanicError } from "../../src/engine/engine-errors";
import { EngineComponentRegistry } from "../../src/engine/engine-component-registry";
import { defineComponent, Types } from "../../src/schema";
import { createRealEngine } from "./harness.js";

describe("component type budget", () => {
  it("128 user types accept writes in WASM and the 129th name throws in defineComponent", async () => {
    let defined = 0;
    const defs = [];
    for (let i = 1; i <= 128; i += 1) {
      try {
        defs.push(
          defineComponent({
            name: `UserType${i}`,
            schema: { v: Types.f32 },
          }),
        );
        defined += 1;
      } catch {
        break;
      }
    }
    expect(defined).toBe(128);

    const handle = await createRealEngine({ variant: "light", maxEntities: 4 });
    let caught: unknown;
    try {
      const entity = handle.bridge.createEntity();
      const bytes = new Uint8Array([1, 0, 0, 0]);
      for (const def of defs) {
        const typeId = handle.engine.getOrRegisterComponent(def.name);
        expect(handle.bridge.addComponent(entity.index, entity.generation, typeId, bytes)).toBe(
          true,
        );
      }
      try {
        defineComponent({ name: "UserType129", schema: { v: Types.f32 } });
      } catch (error: unknown) {
        caught = error;
      }
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

  it("the registry accepts its 128th name and the next wasm layout is refused", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 4 });
    const registry = new EngineComponentRegistry(handle.bridge);
    let caught: unknown;
    let wasmCaught: unknown;
    let registered = 0;
    try {
      for (let i = 1; i <= 128; i += 1) {
        try {
          registry.getOrRegister(`Reg${i}`);
          registered += 1;
        } catch {
          break;
        }
      }
      expect(registered).toBe(128);
      try {
        registry.getOrRegister("Reg129");
      } catch (error: unknown) {
        caught = error;
      }
      try {
        handle.bridge.registerComponent(new Uint8Array([0]));
      } catch (error: unknown) {
        wasmCaught = error;
      }
    } finally {
      await handle.dispose();
    }

    const firstId = registry.get("Reg1");
    expect(firstId).toEqual(expect.any(Number));
    expect(wasmCaught).toBeInstanceOf(GwenWasmError);
    if (!(wasmCaught instanceof GwenWasmError)) {
      throw new Error("expected GwenWasmError");
    }
    expect(wasmCaught.code).toBe(CoreErrorCodes.COMPONENT_TYPE_LIMIT_REACHED);
    expect(caught).toBeInstanceOf(GwenError);
    expect(caught).not.toBeInstanceOf(GwenWasmError);
    expect(caught).not.toBeInstanceOf(GwenWasmPanicError);
    if (!(caught instanceof GwenError)) {
      throw new Error("expected GwenError");
    }
    expect(caught.code).toBe(CoreErrorCodes.COMPONENT_TYPE_LIMIT_REACHED);
    expect(caught.message).toContain("128");
    expect(registry.get("Reg129")).toBeUndefined();
    expect(registry.get("Reg128")).toEqual(expect.any(Number));
  });
});

import { describe, expect, it } from "vitest";

import { CoreErrorCodes, GwenWasmPanicError } from "../../src/engine/engine-errors.js";
import { GwenWasmError } from "../../src/index.js";
import { createRealEngine, type RealEngineHandle } from "./harness.js";

async function useLight(
  maxEntities: number,
  body: (handle: RealEngineHandle) => Promise<void>,
): Promise<RealEngineHandle> {
  const handle = await createRealEngine({ variant: "light", maxEntities });
  try {
    await body(handle);
  } finally {
    await handle.dispose();
  }
  return handle;
}

describe("WASM trap", () => {
  it("an out-of-bounds pointer panics once, then every later call stays poisoned", async () => {
    const handle = await useLight(8, async ({ engine, bridge }) => {
      const seen: Array<{ level: string; code: string; source?: string; error?: unknown }> = [];
      engine.errors.on((event) => {
        seen.push(event);
      });

      const memory = bridge.getLinearMemory();
      if (memory === null) {
        throw new Error("light wasm did not export memory");
      }
      const ptr = 0x7000_0000;

      engine.hooks.hook("engine:before-update", () => {
        bridge.syncTransformsFromBuffer(ptr, 1);
      });
      await engine.advance(1 / 60);

      const fatals = seen.filter(
        (event) => event.level === "fatal" && event.code === CoreErrorCodes.WASM_PANIC,
      );
      expect(fatals).toHaveLength(1);
      const fatal = fatals[0];
      if (fatal === undefined) {
        throw new Error("missing fatal WASM_PANIC");
      }
      expect(fatal.source).toBe("gwen_core.wasm");
      expect(fatal.error).toBeInstanceOf(GwenWasmPanicError);
      expect(fatal.error).not.toBeInstanceOf(GwenWasmError);
      const panic = fatal.error as GwenWasmPanicError;
      expect(panic.exportName).toBe("sync_transforms_from_buffer");
      expect(panic.code).toBe(CoreErrorCodes.WASM_PANIC);

      let next: unknown;
      try {
        bridge.createEntity();
      } catch (error: unknown) {
        next = error;
      }
      expect(next).toBeInstanceOf(GwenWasmPanicError);
      expect(next).not.toBeInstanceOf(GwenWasmError);
      expect((next as GwenWasmPanicError).exportName).toBeUndefined();
      expect(seen.filter((event) => event.code === CoreErrorCodes.WASM_PANIC)).toHaveLength(1);
    });
    expect(handle.engine.state).toBe("stopped");
  });

  it("an infallible export trap poisons the bridge from the frame loop", async () => {
    const handle = await useLight(4, async ({ engine, bridge }) => {
      const id = bridge.createEntity();
      expect(bridge.addComponent(id.index, id.generation, 0xffffffff - 1, new Uint8Array(20))).toBe(
        true,
      );
      engine.hooks.hook("engine:before-update", () => {
        bridge.syncTransformsToBufferSparse(0x7000_0000);
      });

      await engine.startExternal();
      await engine.advance(1 / 60);
      expect(engine.state).toBe("faulted");

      let next: unknown;
      try {
        bridge.createEntity();
      } catch (error: unknown) {
        next = error;
      }
      expect(next).toBeInstanceOf(GwenWasmPanicError);
      expect(next).not.toBeInstanceOf(GwenWasmError);
    });
    expect(handle.engine.state).toBe("stopped");
  });
});

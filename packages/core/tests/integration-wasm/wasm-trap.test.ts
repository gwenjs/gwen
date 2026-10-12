import { describe, expect, it } from "vitest";

import { CoreErrorCodes, GwenWasmPanicError } from "../../src/engine/engine-errors.js";
import { GwenWasmError } from "../../src/index.js";
import { createRealEngine, type RealEngineHandle } from "./harness.js";

/** `teardowns` counts `engine:stop`, so a test can prove `dispose()` tore the engine down. */
async function useLight(
  maxEntities: number,
  body: (handle: RealEngineHandle) => Promise<void>,
): Promise<{ handle: RealEngineHandle; teardowns: number }> {
  const handle = await createRealEngine({ variant: "light", maxEntities });
  let teardowns = 0;
  handle.engine.hooks.hook("engine:stop", () => {
    teardowns += 1;
  });
  try {
    await body(handle);
  } finally {
    await handle.dispose();
  }
  return { handle, teardowns };
}

describe("WASM trap", () => {
  it("an out-of-bounds pointer panics once, then every later call stays poisoned", async () => {
    const { handle, teardowns } = await useLight(8, async ({ engine, bridge }) => {
      const seen: Array<{ level: string; code: string; source?: string; error?: unknown }> = [];
      engine.errors.on((event) => {
        seen.push(event);
      });

      const trap = new WebAssembly.RuntimeError("unreachable");
      engine.hooks.hook("engine:before-update", () => {
        throw trap;
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
      expect(fatal.source).toBe("@gwenjs/core");
      expect(fatal.error).toBe(trap);
      expect(fatal.error).not.toBeInstanceOf(GwenWasmError);

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
    expect(handle.engine.state).toBe("faulted");
    expect(teardowns).toBe(1);
  });

  it("an infallible export trap poisons the bridge from the frame loop", async () => {
    const { handle, teardowns } = await useLight(4, async ({ engine, bridge }) => {
      engine.hooks.hook("engine:before-update", () => {
        throw new WebAssembly.RuntimeError("unreachable");
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
    expect(handle.engine.state).toBe("faulted");
    expect(teardowns).toBe(1);
  });
});

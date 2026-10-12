import { describe, expect, it } from "vitest";

import { CoreErrorCodes, GwenWasmError } from "../../src/engine/engine-errors.js";
import { createRealEngine } from "./harness.js";

const TRANSFORM_STRIDE = 32;

describe("shared buffer free", () => {
  it("a wrong-length free throws CORE:INVALID_SHARED_BUFFER and the buffer still syncs", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 4 });
    try {
      const ptr = handle.bridge.allocSharedBuffer(TRANSFORM_STRIDE);
      let caught: unknown;
      try {
        handle.bridge.freeSharedBuffer(ptr, 16);
      } catch (error: unknown) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(GwenWasmError);
      if (!(caught instanceof GwenWasmError)) throw new Error("expected GwenWasmError");
      expect(caught.code).toBe(CoreErrorCodes.INVALID_SHARED_BUFFER);
      expect(caught.message).toBe(`invalid shared buffer: ptr ${ptr}, len ${TRANSFORM_STRIDE}`);
      handle.bridge.syncTransformsToBuffer(ptr, 1);
    } finally {
      await handle.dispose();
    }
  });

  it("freeing an unknown ptr through the bridge", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 4 });
    try {
      let caught: unknown;
      try {
        handle.bridge.freeSharedBuffer(0x1000, 32);
      } catch (error: unknown) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(GwenWasmError);
      if (!(caught instanceof GwenWasmError)) throw new Error("expected GwenWasmError");
      expect(caught.code).toBe(CoreErrorCodes.INVALID_SHARED_BUFFER);
      expect(caught.message).toBe("invalid shared buffer: ptr 4096, len 0");
      const ptr = handle.bridge.allocSharedBuffer(TRANSFORM_STRIDE);
      handle.bridge.syncTransformsToBuffer(ptr, 1);
    } finally {
      await handle.dispose();
    }
  });
});

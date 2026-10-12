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
      const error = caught as GwenWasmError;
      expect(error.code).toBe(CoreErrorCodes.INVALID_SHARED_BUFFER);
      expect(error.message).toBe(`invalid shared buffer: ptr ${ptr}, len ${TRANSFORM_STRIDE}`);
      handle.bridge.syncTransformsToBuffer(ptr, 1);
    } finally {
      await handle.dispose();
    }
  });
});

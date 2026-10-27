import { describe, expect, it } from "vitest";
import { GwenError } from "@gwenjs/schema";
import { CoreErrorCodes } from "../../src/engine/engine-errors.js";
import { createRealEngine } from "./harness.js";

describe("getPhysicsBridge on the light variant", () => {
  it("getPhysicsBridge on the light variant throws CORE:WASM_VARIANT_MISMATCH naming getPhysicsBridge", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 8 });
    let caught: unknown;

    try {
      try {
        handle.bridge.getPhysicsBridge();
      } catch (err: unknown) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(GwenError);
      if (!(caught instanceof GwenError)) return;
      expect(caught.code).toBe(CoreErrorCodes.WASM_VARIANT_MISMATCH);
      expect(caught.composable).toBe("getPhysicsBridge");
      expect(caught.message.startsWith("[getPhysicsBridge()] ")).toBe(true);
      expect(caught.message.split("\n")[0]).toBe(
        '[getPhysicsBridge()] Physics is not available in the "light" variant.',
      );
      if (__GWEN_DEV__) {
        expect(caught.message).toContain("Fix: ");
      } else {
        expect(caught.message).not.toContain("Fix: ");
      }
    } finally {
      await handle.dispose();
    }
  });
});

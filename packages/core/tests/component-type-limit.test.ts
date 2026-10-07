import { describe, expect, it } from "vitest";

import { GwenError } from "@gwenjs/schema";

import { CoreErrorCodes, GwenWasmError } from "../src/engine/engine-errors";
import { defineComponent, Types } from "../src/schema";

describe("defineComponent type limit", () => {
  it("defining a 128th user component throws at definition time before any WASM call", () => {
    for (let i = 1; i <= 127; i += 1) {
      const defined = defineComponent({
        name: `Limit${i}`,
        schema: { v: Types.f32 },
      });
      expect(defined._typeId).toBe(i);
    }

    let caught: unknown;
    try {
      defineComponent({ name: "PastLimit", schema: { v: Types.f32 } });
    } catch (error: unknown) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(GwenError);
    expect(caught).not.toBeInstanceOf(GwenWasmError);
    if (!(caught instanceof GwenError)) {
      throw new Error("expected GwenError");
    }
    expect(caught.code).toBe(CoreErrorCodes.COMPONENT_TYPE_LIMIT_REACHED);
    expect(caught.message).toContain("128");
    expect(caught.name).toBe("GwenError");
  });
});

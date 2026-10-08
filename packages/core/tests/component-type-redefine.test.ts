import { describe, expect, it } from "vitest";

import { GwenError } from "@gwenjs/schema";

import { CoreErrorCodes } from "../src/engine/engine-errors";
import { defineComponent, Types } from "../src/schema";

describe("defineComponent distinct names", () => {
  it("defining the same name twice still leaves room for the next new name", () => {
    defineComponent({ name: "Health", schema: { v: Types.f32 } });
    defineComponent({ name: "Health", schema: { v: Types.f32 } });

    // Health counts once: 126 more names fill the 127 user types.
    let defined = 0;
    for (let i = 1; i <= 126; i += 1) {
      defineComponent({ name: `Fit${i}`, schema: { v: Types.f32 } });
      defined += 1;
    }
    let caught: unknown;
    try {
      defineComponent({ name: "PastFit", schema: { v: Types.f32 } });
    } catch (error: unknown) {
      caught = error;
    }

    expect(defined).toBe(126);
    expect(caught).toBeInstanceOf(GwenError);
    if (!(caught instanceof GwenError)) {
      throw new Error("expected GwenError");
    }
    expect(caught.code).toBe(CoreErrorCodes.COMPONENT_TYPE_LIMIT_REACHED);
  });
});

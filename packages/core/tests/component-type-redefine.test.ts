import { describe, expect, it } from "vitest";

import { defineComponent, Types } from "../src/schema";

describe("defineComponent distinct names", () => {
  it("defining the same name twice still leaves room for the next new name", () => {
    defineComponent({ name: "Health", schema: { v: Types.f32 } });
    defineComponent({ name: "Health", schema: { v: Types.f32 } });

    let lastId = -1;
    for (let i = 1; i <= 126; i += 1) {
      lastId = defineComponent({ name: `Fit${i}`, schema: { v: Types.f32 } })._typeId;
    }

    expect(lastId).toBe(127);
  });
});

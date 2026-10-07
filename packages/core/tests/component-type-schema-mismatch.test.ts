import { describe, expect, it } from "vitest";

import { GwenError } from "@gwenjs/schema";

import { defineComponent, Types } from "../src/schema";

function catchError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error: unknown) {
    return error;
  }
  return undefined;
}

describe("defineComponent same name, different schema", () => {
  it("the same name with the same schema reuses the id", () => {
    const first = defineComponent({ name: "Same", schema: { x: Types.f32, y: Types.f32 } });
    const second = defineComponent({
      name: "Same",
      schema: { x: Types.f32, y: Types.f32 },
      defaults: { x: 1 },
    });

    expect(second._typeId).toBe(first._typeId);
  });

  it("a different field type for the same name throws and takes no id", () => {
    const hp = defineComponent({ name: "Hp", schema: { v: Types.f32 } });

    const caught = catchError(() => defineComponent({ name: "Hp", schema: { v: Types.i32 } }));
    const next = defineComponent({ name: "AfterHp", schema: { v: Types.f32 } });

    expect(caught).toBeInstanceOf(GwenError);
    if (!(caught instanceof GwenError)) {
      throw new Error("expected GwenError");
    }
    expect(caught.code).toBe("CORE:INVALID_COMPONENT_SCHEMA");
    expect(caught.message).toContain("Hp");
    expect(next._typeId).toBe(hp._typeId + 1);
  });

  it("a renamed or reordered field for the same name throws", () => {
    defineComponent({ name: "Pos", schema: { x: Types.f32, y: Types.f32 } });

    const renamed = catchError(() =>
      defineComponent({ name: "Pos", schema: { x: Types.f32, z: Types.f32 } }),
    );
    const reordered = catchError(() =>
      defineComponent({ name: "Pos", schema: { y: Types.f32, x: Types.f32 } }),
    );
    const extra = catchError(() =>
      defineComponent({ name: "Pos", schema: { x: Types.f32, y: Types.f32, z: Types.f32 } }),
    );

    for (const caught of [renamed, reordered, extra]) {
      expect(caught).toBeInstanceOf(GwenError);
      if (!(caught instanceof GwenError)) {
        throw new Error("expected GwenError");
      }
      expect(caught.code).toBe("CORE:INVALID_COMPONENT_SCHEMA");
    }
  });

});

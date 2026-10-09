import { describe, expect, it } from "vitest";

import { GwenError } from "@gwenjs/schema";

import { createEngine } from "../src/index";
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
  it("the same name with the same schema reuses the id", async () => {
    const engine = await createEngine({ maxEntities: 4 });
    try {
      const first = defineComponent({ name: "Same", schema: { x: Types.f32, y: Types.f32 } });
      const firstId = engine.getOrRegisterComponent(first.name);
      const second = defineComponent({
        name: "Same",
        schema: { x: Types.f32, y: Types.f32 },
        defaults: { x: 1 },
      });

      expect(engine.getOrRegisterComponent(second.name)).toBe(firstId);
      expect(engine.registeredComponentTypes().size).toBe(1);
    } finally {
      await engine.stop();
    }
  });

  it("a different field type for the same name throws and takes no id", async () => {
    const engine = await createEngine({ maxEntities: 4 });
    try {
      const hp = defineComponent({ name: "Hp", schema: { v: Types.f32 } });
      const hpId = engine.getOrRegisterComponent(hp.name);

      const caught = catchError(() => defineComponent({ name: "Hp", schema: { v: Types.i32 } }));
      const next = defineComponent({ name: "AfterHp", schema: { v: Types.f32 } });
      const again = catchError(() => defineComponent({ name: "Hp", schema: { v: Types.f32 } }));

      expect(caught).toBeInstanceOf(GwenError);
      if (!(caught instanceof GwenError)) {
        throw new Error("expected GwenError");
      }
      expect(caught.code).toBe("CORE:INVALID_COMPONENT_SCHEMA");
      expect(caught.message).toContain("Hp");
      expect(again).toBeUndefined();
      expect(engine.getOrRegisterComponent(next.name)).toBe(hpId + 1);
      expect(engine.registeredComponentTypes().size).toBe(2);
    } finally {
      await engine.stop();
    }
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

  it("Types.string and Types.persistentString for the same name throw", () => {
    defineComponent({ name: "Label", schema: { s: Types.string } });

    const caught = catchError(() =>
      defineComponent({ name: "Label", schema: { s: Types.persistentString } }),
    );

    expect(caught).toBeInstanceOf(GwenError);
    if (!(caught instanceof GwenError)) {
      throw new Error("expected GwenError");
    }
    expect(caught.code).toBe("CORE:INVALID_COMPONENT_SCHEMA");
    expect(caught.message).toContain("Label");
  });
});

import { describe, expect, it } from "vitest";

import { GwenError } from "@gwenjs/schema";

import { CoreErrorCodes } from "../src/engine/engine-errors";
import { createEngine } from "../src/index";
import { defineComponent, Types } from "../src/schema";

function defineOrError<T>(fn: () => T): T | GwenError {
  try {
    return fn();
  } catch (error: unknown) {
    if (error instanceof GwenError) return error;
    throw error;
  }
}

function assertDefinition<T>(value: T | GwenError): T {
  expect(value).not.toBeInstanceOf(GwenError);
  if (value instanceof GwenError) {
    throw new Error("expected a component definition");
  }
  return value;
}

describe("defineComponent same name, different schema", () => {
  it("the same name with the same schema reuses the id", async () => {
    const engine = await createEngine({ maxEntities: 4 });
    try {
      const first = defineComponent({ name: "Same", schema: { x: Types.f32, y: Types.f32 } });
      const entity = engine.createEntity();
      engine.addComponent(entity, first, { x: 1, y: 2 });
      const firstId = engine.registeredComponentTypes().get(first.name);

      const second = defineComponent({
        name: "Same",
        schema: { x: Types.f32, y: Types.f32 },
        defaults: { x: 1 },
      });
      const other = engine.createEntity();
      engine.addComponent(other, second, { x: 3, y: 4 });

      expect(engine.registeredComponentTypes().get(second.name)).toBe(firstId);
      expect(engine.registeredComponentTypes().size).toBe(1);
      expect(engine.getComponent(entity, second)?.x).toBe(1);
      expect(engine.getComponent(entity, second)?.y).toBe(2);
      expect(engine.getComponent(other, first)?.x).toBe(3);
      expect(engine.getComponent(other, first)?.y).toBe(4);
    } finally {
      await engine.stop();
    }
  });

  it("a different field type for the same name is refused at first use and takes no id", async () => {
    const engine = await createEngine({ maxEntities: 4 });
    try {
      const hp = defineComponent({ name: "Hp", schema: { v: Types.f32 } });
      const entity = engine.createEntity();
      engine.addComponent(entity, hp, { v: 1 });
      const hpId = engine.registeredComponentTypes().get(hp.name);
      if (hpId === undefined) {
        throw new Error("expected an id");
      }

      const other = assertDefinition(
        defineOrError(() => defineComponent({ name: "Hp", schema: { v: Types.i32 } })),
      );
      let caught: unknown;
      try {
        engine.addComponent(engine.createEntity(), other, { v: 2 });
      } catch (error: unknown) {
        caught = error;
      }

      const again = defineComponent({ name: "Hp", schema: { v: Types.f32 } });
      engine.addComponent(entity, again, { v: 3 });
      const next = defineComponent({ name: "AfterHp", schema: { v: Types.f32 } });
      engine.addComponent(entity, next, { v: 4 });

      expect(caught).toBeInstanceOf(GwenError);
      if (!(caught instanceof GwenError)) {
        throw new Error("expected GwenError");
      }
      expect(caught.code).toBe(CoreErrorCodes.COMPONENT_LAYOUT_INVALID);
      expect(caught.message).toBe("Component layout invalid: Hp");
      expect(engine.getComponent(entity, hp)?.v).toBe(3);
      expect(engine.registeredComponentTypes().get(hp.name)).toBe(hpId);
      expect(engine.registeredComponentTypes().get(next.name)).toBe(hpId + 1);
      expect(engine.registeredComponentTypes().size).toBe(2);
    } finally {
      await engine.stop();
    }
  });

  it("a renamed or reordered field for the same name is judged by lanes", async () => {
    const engine = await createEngine({ maxEntities: 8 });
    try {
      const pos = defineComponent({ name: "Pos", schema: { x: Types.f32, y: Types.f32 } });
      const entity = engine.createEntity();
      engine.addComponent(entity, pos, { x: 1, y: 2 });
      const posId = engine.registeredComponentTypes().get("Pos");

      // Scalar lanes in field order. The same lanes reuse the id.
      const renamed = assertDefinition(
        defineOrError(() =>
          defineComponent({ name: "Pos", schema: { x: Types.f32, z: Types.f32 } }),
        ),
      );
      engine.addComponent(engine.createEntity(), renamed, { x: 3, z: 4 });

      const reordered = assertDefinition(
        defineOrError(() =>
          defineComponent({ name: "Pos", schema: { y: Types.f32, x: Types.f32 } }),
        ),
      );
      const reorderedRow = engine.createEntity();
      engine.addComponent(reorderedRow, reordered, { y: 5, x: 6 });

      const firstOrder = engine.createEntity();
      engine.addComponent(firstOrder, pos, { x: 11, y: 22 });
      const throughReordered = engine.getComponent(firstOrder, reordered);

      const extra = assertDefinition(
        defineOrError(() =>
          defineComponent({
            name: "Pos",
            schema: { x: Types.f32, y: Types.f32, z: Types.f32 },
          }),
        ),
      );
      let extraCaught: unknown;
      try {
        engine.addComponent(engine.createEntity(), extra, { x: 7, y: 8, z: 9 });
      } catch (error: unknown) {
        extraCaught = error;
      }

      expect(engine.registeredComponentTypes().get("Pos")).toBe(posId);
      expect(engine.registeredComponentTypes().size).toBe(1);
      expect(engine.getComponent(entity, pos)?.x).toBe(1);
      expect(engine.getComponent(entity, pos)?.y).toBe(2);
      expect(engine.getComponent(reorderedRow, pos)?.x).toBe(6);
      expect(engine.getComponent(reorderedRow, pos)?.y).toBe(5);
      expect(throughReordered?.x).toBe(11);
      expect(throughReordered?.y).toBe(22);
      expect(extraCaught).toBeInstanceOf(GwenError);
      if (!(extraCaught instanceof GwenError)) {
        throw new Error("expected GwenError");
      }
      expect(extraCaught.code).toBe(CoreErrorCodes.COMPONENT_LAYOUT_INVALID);
      expect(extraCaught.message).toBe("Component layout invalid: Pos");
    } finally {
      await engine.stop();
    }
  });

  it("Types.string and Types.persistentString for the same name reuse the id", async () => {
    const engine = await createEngine({ maxEntities: 4 });
    try {
      const label = defineComponent({ name: "Label", schema: { s: Types.string } });
      const entity = engine.createEntity();
      engine.addComponent(entity, label, { s: "kept" });
      const labelId = engine.registeredComponentTypes().get("Label");

      // Both types use one string lane. The engine does not see `isPersistent`.
      const persistent = assertDefinition(
        defineOrError(() =>
          defineComponent({ name: "Label", schema: { s: Types.persistentString } }),
        ),
      );
      engine.addComponent(engine.createEntity(), persistent, { s: "other" });

      expect(engine.registeredComponentTypes().size).toBe(1);
      expect(engine.registeredComponentTypes().get("Label")).toBe(labelId);
      expect(engine.getComponent(entity, label)?.s).toBe("kept");
    } finally {
      await engine.stop();
    }
  });
});

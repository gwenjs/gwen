import { describe, expect, it } from "vitest";

import { GwenError } from "@gwenjs/schema";

import { CoreErrorCodes } from "../src/engine/engine-errors";
import { defineComponent, Types, type ComponentDefinition } from "../src/schema";
import { createRealEngine } from "../src/testing/create-real-engine.js";

type ScalarDef = ComponentDefinition<{ v: typeof Types.f32 }>;

describe("defineComponent distinct names", () => {
  it("defining the same name twice still leaves room for the next new name", async () => {
    const health = defineComponent({ name: "Health", schema: { v: Types.f32 } });
    const healthAgain = defineComponent({ name: "Health", schema: { v: Types.f32 } });

    const more: ScalarDef[] = [];
    for (let i = 1; i <= 127; i += 1) {
      more.push(defineComponent({ name: `Fit${i}`, schema: { v: Types.f32 } }));
    }

    let past: ScalarDef | undefined;
    let pastError: unknown;
    try {
      past = defineComponent({ name: "PastFit", schema: { v: Types.f32 } });
    } catch (error: unknown) {
      pastError = error;
    }
    expect(pastError).toBeUndefined();
    if (past === undefined) {
      throw new Error("expected a component definition");
    }

    const handle = await createRealEngine({ variant: "light", maxEntities: 4 });
    try {
      const engine = handle.engine;
      const entity = engine.createEntity();
      engine.addComponent(entity, health, { v: 1 });
      engine.addComponent(entity, healthAgain, { v: 2 });
      for (const def of more) {
        engine.addComponent(entity, def, { v: 1 });
      }
      expect(engine.registeredComponentTypes().size).toBe(128);
      expect(engine.getComponent(entity, health)?.v).toBe(2);

      let caught: unknown;
      try {
        engine.addComponent(entity, past, { v: 1 });
      } catch (error: unknown) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(GwenError);
      if (!(caught instanceof GwenError)) {
        throw new Error("expected GwenError");
      }
      expect(caught.code).toBe(CoreErrorCodes.COMPONENT_TYPE_LIMIT_REACHED);
      expect(caught.message).toContain("128");
      expect(engine.registeredComponentTypes().size).toBe(128);
      expect(engine.registeredComponentTypes().get("PastFit")).toBeUndefined();
    } finally {
      await handle.dispose();
    }
  });
});

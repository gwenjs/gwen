import { describe, expect, it } from "vitest";

import { GwenError } from "@gwenjs/schema";

import { CoreErrorCodes, GwenWasmError } from "../src/engine/engine-errors";
import { defineComponent, Types, type ComponentDefinition } from "../src/schema";
import { createRealEngine } from "../src/testing/create-real-engine.js";

type ScalarDef = ComponentDefinition<{ v: typeof Types.f32 }>;

describe("defineComponent type limit", () => {
  it("the 128th user component is accepted and the 129th is refused at first use", async () => {
    const defs: ScalarDef[] = [];
    let defined = 0;
    for (let i = 1; i <= 129; i += 1) {
      try {
        defs.push(defineComponent({ name: `Limit${i}`, schema: { v: Types.f32 } }));
        defined += 1;
      } catch {
        break;
      }
    }
    expect(defined).toBe(129);

    const handle = await createRealEngine({ variant: "light", maxEntities: 4 });
    try {
      const engine = handle.engine;
      const entity = engine.createEntity();
      for (let i = 0; i < 128; i += 1) {
        const def = defs[i];
        if (def === undefined) {
          throw new Error("expected a definition");
        }
        engine.addComponent(entity, def, { v: 1 });
      }
      expect(engine.registeredComponentTypes().size).toBe(128);

      const past = defs[128];
      if (past === undefined) {
        throw new Error("expected a definition");
      }
      let caught: unknown;
      try {
        engine.addComponent(entity, past, { v: 1 });
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
      expect(engine.registeredComponentTypes().size).toBe(128);
      expect(engine.registeredComponentTypes().get("Limit129")).toBeUndefined();
    } finally {
      await handle.dispose();
    }
  });
});

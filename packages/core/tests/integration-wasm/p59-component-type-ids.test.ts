/**
 * Component type ids belong to each engine (#59), with the #52 definition checks kept.
 */
import { describe, expect, it } from "vitest";
import { defineComponent, Types } from "../../src/index.js";
import { createRealEngine } from "./harness.js";

describe("component type ids per engine", () => {
  it("two engines register the same components in different orders and get independent ids", async () => {
    const IdA = defineComponent({ name: "P59IdA", schema: { v: Types.f32 } });
    const IdB = defineComponent({ name: "P59IdB", schema: { v: Types.f32 } });
    const IdC = defineComponent({ name: "P59IdC", schema: { v: Types.f32 } });
    const handleA = await createRealEngine({ variant: "light", maxEntities: 8 });
    const handleB = await createRealEngine({ variant: "light", maxEntities: 8 });
    try {
      const a = handleA.engine;
      const b = handleB.engine;
      const entityA = a.createEntity();
      a.addComponent(entityA, IdA, { v: 1 });
      a.addComponent(entityA, IdB, { v: 2 });
      a.addComponent(entityA, IdC, { v: 3 });
      const entityB = b.createEntity();
      b.addComponent(entityB, IdC, { v: 30 });
      b.addComponent(entityB, IdB, { v: 20 });
      b.addComponent(entityB, IdA, { v: 10 });

      const idsA = a.registeredComponentTypes();
      const idsB = b.registeredComponentTypes();
      // A definition carries no WASM id: the engine that first sees it assigns one.
      expect([IdA._typeId, IdB._typeId, IdC._typeId]).toEqual([0, 0, 0]);
      expect(idsA.get("P59IdA")).toBe(idsB.get("P59IdC"));
      expect(idsA.get("P59IdB")).toBe(idsB.get("P59IdB"));
      expect(idsA.get("P59IdC")).toBe(idsB.get("P59IdA"));
      expect(idsA.get("P59IdA")).not.toBe(idsA.get("P59IdC"));
      expect(a.getComponent(entityA, IdA)?.v).toBe(1);
      expect(a.getComponent(entityA, IdC)?.v).toBe(3);
      expect(b.getComponent(entityB, IdA)?.v).toBe(10);
      expect(b.getComponent(entityB, IdC)?.v).toBe(30);

      // Hot reload with the same layout keeps the id in each engine.
      const IdAReloaded = defineComponent({ name: "P59IdA", schema: { v: Types.f32 } });
      expect(a.getOrRegisterComponent(IdAReloaded.name)).toBe(idsA.get("P59IdA"));
      expect(b.getOrRegisterComponent(IdAReloaded.name)).toBe(idsB.get("P59IdA"));
      expect(a.getComponent(entityA, IdAReloaded)?.v).toBe(1);
      expect(idsA.size).toBe(3);
      expect(idsB.size).toBe(3);
    } finally {
      await handleA.dispose();
      await handleB.dispose();
    }
  });
});

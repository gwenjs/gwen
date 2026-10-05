import { describe, expect, it } from "vitest";

import { entityIndex } from "../../src/internal";
import { CoreErrorCodes, createEngine, type EntityId } from "../../src/index";

describe("entity:destroy", () => {
  it("fires once, synchronously, after the entity is dead", async () => {
    const engine = await createEngine({ maxEntities: 16 });
    const seen: EntityId[] = [];
    let aliveDuring: boolean | undefined;

    engine.hooks.hook("entity:destroy", (id) => {
      seen.push(id);
      aliveDuring = engine.isAlive(id);
    });

    const id = engine.createEntity();
    expect(engine.destroyEntity(id)).toBe(true);
    expect(seen).toEqual([id]);
    expect(aliveDuring).toBe(false);
    expect(engine.isAlive(id)).toBe(false);
  });

  it("does not fire for a dead id or a stale id", async () => {
    const engine = await createEngine({ maxEntities: 16 });
    const seen: EntityId[] = [];
    engine.hooks.hook("entity:destroy", (id) => {
      seen.push(id);
    });

    const stale = engine.createEntity();
    expect(engine.destroyEntity(stale)).toBe(true);
    expect(seen).toEqual([stale]);

    expect(engine.destroyEntity(stale)).toBe(false);
    expect(seen).toEqual([stale]);

    const reused = engine.createEntity();
    expect(entityIndex(reused)).toBe(entityIndex(stale));
    expect(reused).not.toBe(stale);
    expect(engine.destroyEntity(stale)).toBe(false);
    expect(seen).toEqual([stale]);
    expect(engine.isAlive(reused)).toBe(true);
  });

  it("runs later handlers when the first throws, and reports the failure", async () => {
    const engine = await createEngine({ maxEntities: 16 });
    const order: string[] = [];
    const reported: Array<{
      level: string;
      code: string;
      source?: string;
      context?: Record<string, unknown>;
    }> = [];

    engine.errors.on((event) => {
      reported.push(event);
    });
    engine.hooks.hook("entity:destroy", () => {
      order.push("first");
      throw new Error("handler failed");
    });
    engine.hooks.hook("entity:destroy", () => {
      order.push("second");
    });

    const id = engine.createEntity();
    expect(engine.destroyEntity(id)).toBe(true);
    expect(order).toEqual(["first", "second"]);
    expect(reported).toEqual([
      expect.objectContaining({
        level: "error",
        code: CoreErrorCodes.PLUGIN_RUNTIME_ERROR,
        source: "entity:destroy",
        context: { entityId: id },
      }),
    ]);
  });

  it("runs beforeEach when entity:destroy fires", async () => {
    const engine = await createEngine({ maxEntities: 8 });
    const names: string[] = [];
    engine.hooks.beforeEach((event) => {
      names.push(event.name);
    });

    const id = engine.createEntity();
    expect(engine.destroyEntity(id)).toBe(true);
    expect(names).toContain("entity:destroy");
  });
});

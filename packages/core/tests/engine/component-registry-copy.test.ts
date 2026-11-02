/**
 * `registeredComponentTypes()` returns a copy.
 * Writing to the result must not change the ids the engine hands out.
 */
import { afterEach, describe, expect, it } from "vitest";

import type { GwenEngine } from "../../src/engine/engine-types.js";
import { createRealEngine, type RealEngineHandle } from "../../src/testing/create-real-engine.js";

describe("registeredComponentTypes copy", () => {
  const handles: RealEngineHandle[] = [];

  afterEach(async () => {
    const pending = handles.splice(0);
    for (const handle of pending) await handle.dispose();
  });

  async function openEngine(): Promise<GwenEngine> {
    const handle = await createRealEngine({ variant: "light", maxEntities: 8 });
    handles.push(handle);
    return handle.engine;
  }

  it("mutating the returned map does not change type ids", async () => {
    const engine = await openEngine();
    expect(engine.getOrRegisterComponent("Position")).toBe(0);

    const view = engine.registeredComponentTypes() as Map<string, number>;
    view.set("Position", 7);
    view.set("Ghost", 9);
    view.delete("Position");
    view.clear();

    expect(engine.getOrRegisterComponent("Position")).toBe(0);
    expect(engine.getOrRegisterComponent("Velocity")).toBe(1);
    expect(Array.from(engine.registeredComponentTypes())).toEqual([
      ["Position", 0],
      ["Velocity", 1],
    ]);
  });

  it("two calls return distinct objects with equal entries", async () => {
    const engine = await openEngine();
    engine.getOrRegisterComponent("Position");
    engine.getOrRegisterComponent("Velocity");

    const a = engine.registeredComponentTypes();
    const b = engine.registeredComponentTypes();

    expect(a).not.toBe(b);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(Array.from(a)).toEqual([
      ["Position", 0],
      ["Velocity", 1],
    ]);
  });

  it("zero components gives an empty map", async () => {
    const engine = await openEngine();
    expect(engine.registeredComponentTypes().size).toBe(0);

    // A plugin type released by unuse() leaves a registry that exists and holds no name.
    await engine.use({
      name: "copy-empty-registry",
      setup(eng: GwenEngine) {
        eng.getOrRegisterComponent("Transient");
      },
    });
    expect(engine.registeredComponentTypes().size).toBe(1);
    await engine.unuse("copy-empty-registry");

    const empty = engine.registeredComponentTypes();
    expect(empty.size).toBe(0);
    (empty as Map<string, number>).set("Ghost", 9);

    expect(engine.registeredComponentTypes().size).toBe(0);
    expect(engine.getOrRegisterComponent("Fresh")).toBe(0);
  });
});

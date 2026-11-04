import { describe, expect, it } from "vitest";
import { GwenError } from "@gwenjs/schema";
import { createEngine } from "../../src/node";
import { defineComponent } from "../../src/schema";
import { definePrefab } from "../../src/actor/runtime/define-prefab";
import { defineActor } from "../../src/actor/runtime/define-actor";
import { defineSystem } from "../../src/system/runtime/define-system";
import { TweenPlugin } from "../../src/tween/engine-plugin";
import { useSequence } from "../../src/tween/runtime/use-sequence";
import { useTween } from "../../src/tween/runtime/use-tween";

function codeOf(error: unknown): string | undefined {
  return error instanceof GwenError ? error.code : undefined;
}

describe("a definition that misses its body", () => {
  it("defineSystem(name) throws CORE:DEFINITION_INCOMPLETE when the system is set up", async () => {
    const engine = await createEngine({});
    try {
      const Sys = Reflect.apply(defineSystem, undefined, ["NoSetupSystem"]);
      const error = await engine.use(Sys()).then(
        () => undefined,
        (caught: unknown) => caught,
      );
      expect(codeOf(error)).toBe("CORE:DEFINITION_INCOMPLETE");
      expect(error).toHaveProperty("message", expect.stringContaining("needs a setup function"));
    } finally {
      await engine.stop();
    }
  });

  it("defineComponent(name) throws CORE:DEFINITION_INCOMPLETE", () => {
    let error: unknown;
    try {
      Reflect.apply(defineComponent, undefined, ["NoFactoryComponent"]);
    } catch (caught) {
      error = caught;
    }
    expect(codeOf(error)).toBe("CORE:DEFINITION_INCOMPLETE");
    expect(error).toHaveProperty("message", expect.stringContaining("needs a factory"));
  });

  it("defineActor(name, prefab) throws CORE:DEFINITION_INCOMPLETE and names the actor", () => {
    const prefab = definePrefab([]);
    let error: unknown;
    try {
      Reflect.apply(defineActor, undefined, ["NoFactoryActor", prefab]);
    } catch (caught) {
      error = caught;
    }
    expect(codeOf(error)).toBe("CORE:DEFINITION_INCOMPLETE");
    expect(error).toHaveProperty(
      "message",
      expect.stringContaining('defineActor("NoFactoryActor"'),
    );
  });

  it("defineActor(prefab) throws CORE:DEFINITION_INCOMPLETE", () => {
    const prefab = definePrefab([]);
    let error: unknown;
    try {
      Reflect.apply(defineActor, undefined, [prefab]);
    } catch (caught) {
      error = caught;
    }
    expect(codeOf(error)).toBe("CORE:DEFINITION_INCOMPLETE");
    expect(error).toHaveProperty(
      "message",
      expect.stringContaining("needs a prefab, then a factory"),
    );
  });

  it("defineActor(prefab, factory, fn) with a function as third argument throws CORE:DEFINITION_INCOMPLETE", () => {
    const prefab = definePrefab([]);
    let error: unknown;
    try {
      Reflect.apply(defineActor, undefined, [prefab, () => ({}), () => ({})]);
    } catch (caught) {
      error = caught;
    }
    expect(codeOf(error)).toBe("CORE:DEFINITION_INCOMPLETE");
    expect(error).toHaveProperty(
      "message",
      expect.stringContaining("needs a prefab, then a factory"),
    );
  });

  it("a sequence wait step on an exhausted drop pool throws CORE:TWEEN_POOL_EXHAUSTED", async () => {
    const engine = await createEngine({ maxEntities: 100 });
    try {
      await engine.use(TweenPlugin({ poolSize: 1, poolPolicy: { onExhausted: "drop" } }));
      let error: unknown;
      engine.run(() => {
        const taken = useTween<number>({ duration: 1 });
        expect(taken).not.toBeNull();
        const seq = useSequence([{ wait: 0.5 }]);
        try {
          seq.play();
        } catch (caught) {
          error = caught;
        }
      });
      expect(codeOf(error)).toBe("CORE:TWEEN_POOL_EXHAUSTED");
      expect(error).toHaveProperty("message", expect.stringContaining("dropped the wait step"));
    } finally {
      await engine.stop();
    }
  });
});

import { describe, it, expect, vi, expectTypeOf } from "vitest";
import { createEngine } from "../../src";
import { defineHooks } from "../../src/hooks";
import type { InferHooks } from "../../src/hooks";
import { emit, useHook } from "../../src";

const GameHooks = defineHooks({
  "enemy:died": (_id: bigint): void => undefined,
  "player:damage": (_amount: number): void => undefined,
  "level:complete": (): void => undefined,
});

declare module "@gwenjs/schema" {
  interface GwenRuntimeHooks extends InferHooks<typeof GameHooks> {}
}

describe("defineHooks()", () => {
  it("returns the exact same object at runtime (identity)", () => {
    const map = { "foo:bar": (_x: number): void => undefined };
    expect(defineHooks(map)).toBe(map);
  });

  it("preserves all keys", () => {
    expect(Object.keys(GameHooks)).toEqual(["enemy:died", "player:damage", "level:complete"]);
  });
});

describe("InferHooks<T>", () => {
  it("maps hook keys to their handler types", () => {
    type Hooks = InferHooks<typeof GameHooks>;
    expectTypeOf<Hooks["enemy:died"]>().toEqualTypeOf<(_id: bigint) => void>();
    expectTypeOf<Hooks["player:damage"]>().toEqualTypeOf<(_amount: number) => void>();
    expectTypeOf<Hooks["level:complete"]>().toEqualTypeOf<() => void>();
  });
});

describe("emit() with declared hooks", () => {
  it("accepts declared hook keys and args without cast", async () => {
    const engine = await createEngine();
    const spy = vi.fn();
    engine.hooks.hook("enemy:died" as never, spy as never);
    engine.run(() => {
      emit("enemy:died", 42n);
      emit("player:damage", 10);
      emit("level:complete");
    });
    expect(spy).toHaveBeenCalledWith(42n);
    await engine.stop();
  });
});

describe("useHook() with declared hooks", () => {
  it("accepts declared hook keys inside engine context", async () => {
    const engine = await createEngine();
    const spy = vi.fn();
    await engine.run(() => {
      useHook("enemy:died", (id) => spy(id));
    });
    engine.hooks.callHook("enemy:died", 99n);
    expect(spy).toHaveBeenCalledWith(99n);
    await engine.stop();
  });
});

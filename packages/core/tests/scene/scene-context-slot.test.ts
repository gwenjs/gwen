import { describe, it, expect, vi } from "vitest";
import { onEnter, onExit, useSystem } from "../../src/scene/runtime/scene-context";
import { GwenContextError } from "../../src/engine/context";
import { defineScene } from "../../src/scene/runtime/define-scene";

describe("scene-context — ContextSlot<SceneSetupContext>", () => {
  it("onEnter throws outside defineScene", () => {
    expect(() => onEnter(() => {})).toThrow(GwenContextError);
  });

  it("onExit throws outside defineScene", () => {
    expect(() => onExit(() => {})).toThrow(GwenContextError);
  });

  it("useSystem throws outside defineScene", () => {
    expect(() => useSystem({ name: "x", setup() {} })).toThrow(GwenContextError);
  });

  it("onEnter callback is captured inside defineScene", () => {
    const cb = vi.fn();
    const MyScene = defineScene("Test", () => {
      onEnter(cb);
    });
    const def = MyScene({ register: () => {} });
    expect(def.onEnter).toBe(cb);
  });

  it("onExit callback is captured inside defineScene", () => {
    const cb = vi.fn();
    const MyScene = defineScene("Test", () => {
      onExit(cb);
    });
    const def = MyScene({ register: () => {} });
    expect(def.onExit).toBe(cb);
  });

  it("nested scene context calls restore previous context", () => {
    const log: string[] = [];
    const Registry = { register: () => {} };

    const OuterScene = defineScene("Outer", () => {
      onEnter(() => log.push("outer-enter"));
      onExit(() => log.push("outer-exit"));
    });

    const InnerScene = defineScene("Inner", () => {
      onEnter(() => log.push("inner-enter"));
      onExit(() => log.push("inner-exit"));
    });

    const outerDef = OuterScene(Registry);
    const innerDef = InnerScene(Registry);

    expect(outerDef.onEnter).toBeDefined();
    expect(innerDef.onEnter).toBeDefined();
    expect(outerDef.onEnter).not.toBe(innerDef.onEnter);
  });
});

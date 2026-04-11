import { describe, it, expect, vi } from "vitest";
import { defineScene } from "../../src/scene/define-scene.js";
import { useSystem, onEnter, onExit } from "../../src/scene/scene-context.js";
import { GwenContextError } from "../../src/context.js";
import type { GwenPlugin } from "../../src/engine/gwen-engine.js";

const dummyPlugin = (name: string) =>
  ({ name, apiVersion: 1, setup() {} }) as unknown as GwenPlugin;

const REGISTRY = { register: () => {} };

describe("defineScene composable API", () => {
  it("useSystem registers systems in the SceneDefinition", () => {
    const A = dummyPlugin("A");
    const B = dummyPlugin("B");
    const MyScene = defineScene("Test", () => {
      useSystem([A, B]);
    });
    const def = MyScene(REGISTRY);
    expect(def.systems).toHaveLength(2);
    expect(def.systems).toContain(A);
    expect(def.systems).toContain(B);
  });

  it("onEnter callback is captured and stored", () => {
    const cb = vi.fn();
    const MyScene = defineScene("Test", () => {
      useSystem([]);
      onEnter(cb);
    });
    const def = MyScene(REGISTRY);
    expect(def.onEnter).toBe(cb);
  });

  it("onExit callback is captured and stored", () => {
    const cb = vi.fn();
    const MyScene = defineScene("Test", () => {
      useSystem([]);
      onExit(cb);
    });
    const def = MyScene(REGISTRY);
    expect(def.onExit).toBe(cb);
  });

  it("factory result is cached — calling SceneFactory twice returns the same SceneDefinition", () => {
    let callCount = 0;
    const MyScene = defineScene("Test", () => {
      callCount++;
      useSystem([]);
    });
    const def1 = MyScene(REGISTRY);
    const def2 = MyScene(REGISTRY);
    expect(def1).toBe(def2);
    expect(callCount).toBe(1);
  });

  it("SceneFactory has a sceneName property", () => {
    const MyScene = defineScene("MyScene", () => {
      useSystem([]);
    });
    expect((MyScene as any).sceneName).toBe("MyScene");
  });

  it("useSystem throws GwenContextError if called outside a factory", () => {
    expect(() => useSystem([dummyPlugin("A")])).toThrow(GwenContextError);
  });

  it("onEnter throws GwenContextError if called outside a factory", () => {
    expect(() => onEnter(() => {})).toThrow(GwenContextError);
  });

  it("onExit throws GwenContextError if called outside a factory", () => {
    expect(() => onExit(() => {})).toThrow(GwenContextError);
  });
});

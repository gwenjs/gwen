import { stubComponent } from "../helpers/stub-component";
import { describe, it, expect, vi } from "vitest";
import { defineScene } from "../../src/scene/runtime/define-scene";
import {
  useSystem,
  onEnter,
  onExit,
  onTransitionExit,
  onTransitionEnter,
} from "../../src/scene/runtime/scene-context";
import { GwenContextError } from "../../src/engine/context";
import { createEngine } from "../../src/node.js";
import { definePrefab } from "../../src/actor/runtime/define-prefab";
import { defineActor } from "../../src/actor/runtime/define-actor";
import { useActor } from "../../src/actor/runtime/use-actor";
import { SCENE_REGISTRAR_KEY } from "../../src/scene/runtime/scene-registrar";
import type { GwenPlugin } from "../../src/engine/engine-types.js";
import type { SceneRegistrar } from "../../src/scene/runtime/scene-registrar";

const dummyPlugin = (name: string) =>
  ({ name, apiVersion: 1, setup() {} }) as unknown as GwenPlugin;

const REGISTRY = { register: () => {} };
const Position = stubComponent("Position");

describe("defineScene composable API", () => {
  it("useSystem registers systems in the SceneDefinition", () => {
    const A = dummyPlugin("A");
    const B = dummyPlugin("B");
    const MyScene = defineScene("Test", () => {
      useSystem(A);
      useSystem(B);
    });
    const def = MyScene(REGISTRY);
    expect(def.systems).toHaveLength(2);
    expect(def.systems.some((p) => p.name === "A")).toBe(true);
    expect(def.systems.some((p) => p.name === "B")).toBe(true);
  });

  it("onEnter callback is captured and stored", () => {
    const cb = vi.fn();
    const MyScene = defineScene("Test", () => {
      onEnter(cb);
    });
    const def = MyScene(REGISTRY);
    expect(def.onEnter).toBe(cb);
  });

  it("onExit callback is captured and stored", () => {
    const cb = vi.fn();
    const MyScene = defineScene("Test", () => {
      onExit(cb);
    });
    const def = MyScene(REGISTRY);
    expect(def.onExit).toBe(cb);
  });

  it("factory result is cached — calling SceneFactory twice returns the same SceneDefinition", () => {
    let callCount = 0;
    const MyScene = defineScene("Test", () => {
      callCount++;
    });
    const def1 = MyScene(REGISTRY);
    const def2 = MyScene(REGISTRY);
    expect(def1).toBe(def2);
    expect(callCount).toBe(1);
  });

  it("SceneFactory has a sceneName property", () => {
    const MyScene = defineScene("MyScene", () => {});
    expect((MyScene as any).sceneName).toBe("MyScene");
  });

  it("useSystem throws GwenContextError if called outside a factory", () => {
    expect(() => useSystem(dummyPlugin("A"))).toThrow(GwenContextError);
  });

  it("onEnter throws GwenContextError if called outside a factory", () => {
    expect(() => onEnter(() => {})).toThrow(GwenContextError);
  });

  it("onExit throws GwenContextError if called outside a factory", () => {
    expect(() => onExit(() => {})).toThrow(GwenContextError);
  });

  it("onTransitionExit throws GwenContextError if called outside a factory", () => {
    expect(() => onTransitionExit(() => {})).toThrow(GwenContextError);
  });

  it("onTransitionEnter throws GwenContextError if called outside a factory", () => {
    expect(() => onTransitionEnter(() => {})).toThrow(GwenContextError);
  });

  it("onTransitionExit callback is captured and stored", () => {
    const cb = vi.fn();
    const MyScene = defineScene("Test", () => {
      onTransitionExit(cb);
    });
    const def = MyScene(REGISTRY);
    expect(def.onTransitionExit).toBe(cb);
  });

  it("onTransitionExit fires on scene:transition:leave and is awaited", async () => {
    const steps: string[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const MyScene = defineScene("TransitionExitScene", () => {
      onTransitionExit(async (payload) => {
        steps.push(`start ${payload.from}->${payload.to}`);
        await gate;
        steps.push("end");
      });
    });
    const engine = await createEngine();
    try {
      engine.run(() => {
        MyScene(REGISTRY);
      });
      let settled = false;
      const hookDone = (async () => {
        await engine.hooks.callHook("scene:transition:leave", {
          from: "TransitionExitScene",
          to: "Other",
        });
        settled = true;
      })();
      // Let every pending microtask and one macrotask run: a hook that does not
      // await the callback would settle here, while the callback is still gated.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(steps).toEqual(["start TransitionExitScene->Other"]);
      expect(settled).toBe(false);
      release();
      await hookDone;
      steps.push("after hook");
      expect(steps).toEqual(["start TransitionExitScene->Other", "end", "after hook"]);
    } finally {
      await engine.stop();
    }
  });

  it("onTransitionEnter callback is captured and stored", () => {
    const cb = vi.fn();
    const MyScene = defineScene("Test", () => {
      onTransitionEnter(cb);
    });
    const def = MyScene(REGISTRY);
    expect(def.onTransitionEnter).toBe(cb);
  });

  it("useActor can register actor plugins through engine-backed scene context", async () => {
    const engine = await createEngine();
    const prefab = definePrefab([{ def: Position, defaults: { x: 0, y: 0 } }]);
    const Actor = defineActor(prefab, () => ({}));
    const systems: GwenPlugin[] = [];
    const registrar: SceneRegistrar = {
      register: (p) => {
        if (!systems.includes(p)) systems.push(p);
      },
    };

    engine.run(() => {
      engine.provide(SCENE_REGISTRAR_KEY, registrar);
      useActor(Actor);
    });

    expect(systems).toContain(Actor._plugin);
  });
});

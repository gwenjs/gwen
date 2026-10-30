import { describe, expect, it } from "vitest";
import type { GwenKit } from "@gwenjs/schema";
import sceneModule from "../../src/scene/module.js";
import tweenModule from "../../src/tween/module.js";

function isKit(value: object): value is GwenKit {
  return "options" in value;
}

function recordingKit(stored: unknown[]): GwenKit {
  const target = { options: {} };
  const proxy = new Proxy(target, {
    get(receiver, key) {
      if (typeof key !== "string") return undefined;
      if (key in receiver) return Reflect.get(receiver, key);
      if (key === "addPlugin") {
        return (decl: unknown) => {
          stored.push(decl);
        };
      }
      return () => undefined;
    },
  });
  if (!isKit(proxy)) throw new Error("recording kit is missing options");
  return proxy;
}

async function recorded(setup: (kit: GwenKit) => void | Promise<void>): Promise<unknown> {
  const stored: unknown[] = [];
  try {
    await setup(recordingKit(stored));
  } catch (error) {
    return error;
  }
  return stored;
}

describe("built-in scene and tween modules", () => {
  it("scene and tween modules declare their plugins from @gwenjs/core/internal", async () => {
    expect(await recorded((kit) => sceneModule.setup({}, kit))).toEqual([
      { src: "@gwenjs/core/internal", export: "SceneEnginePlugin" },
    ]);
    expect(await recorded((kit) => tweenModule.setup({ poolSize: 256 }, kit))).toEqual([
      {
        src: "@gwenjs/core/internal",
        export: "TweenPlugin",
        options: { poolSize: 256 },
      },
    ]);
  });

  it("the declared exports exist", async () => {
    const mod = await import("../../src/internal.js");
    expect(typeof mod.SceneEnginePlugin).toBe("function");
    expect(typeof mod.TweenPlugin).toBe("function");
    if (typeof mod.SceneEnginePlugin !== "function" || typeof mod.TweenPlugin !== "function") {
      throw new Error("expected plugin factories");
    }
    const scene = mod.SceneEnginePlugin();
    const tween = mod.TweenPlugin();
    expect(scene.name.length).toBeGreaterThan(0);
    expect(tween.name.length).toBeGreaterThan(0);
  });
});

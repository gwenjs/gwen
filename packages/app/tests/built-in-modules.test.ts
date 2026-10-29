/**
 * @file Tests for built-in modules loaded by GwenApp.setupModules()
 */

import { describe, it, expect } from "vitest";
import { GwenApp } from "../src/app.js";
import { resolveLoadedConfig } from "../src/config.js";

describe("GwenApp.setupModules — built-in modules", () => {
  it("registers auto-imports from all built-in modules", async () => {
    const app = new GwenApp();
    await app.setupModules(resolveLoadedConfig({}));

    const names = app.autoImports.map((i) => i.name);
    expect(names).toContain("defineSystem");
    expect(names).toContain("defineActor");
    expect(names).toContain("defineScene");
    expect(names).toContain("useSceneRouter");
  });

  it("registers SceneEnginePlugin via the scene module", async () => {
    const app = new GwenApp();
    await app.setupModules(resolveLoadedConfig({}));

    const scenePlugin = app.plugins.find((p) => p.name === "gwen:scene");
    expect(scenePlugin).toBeDefined();
  });

  it("registers TweenPlugin via the tween module", async () => {
    const app = new GwenApp();
    await app.setupModules(resolveLoadedConfig({}));

    const tweenPlugin = app.plugins.find((p) => p.name === "gwen:tween");
    expect(tweenPlugin).toBeDefined();
  });

  it("forwards tween poolSize to TweenPlugin via configKey", async () => {
    const app = new GwenApp();
    await app.setupModules(
      resolveLoadedConfig({
        tween: { poolSize: 512 },
      } as Record<string, unknown>),
    );

    const tweenPlugin = app.plugins.find((p) => p.name === "gwen:tween");
    expect(tweenPlugin).toBeDefined();
  });
});

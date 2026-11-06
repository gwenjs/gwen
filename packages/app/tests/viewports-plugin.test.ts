/**
 * @file viewports-plugin tests
 *
 * Verifies that createViewportsPlugin registers viewports on engine:init,
 * including the default fullscreen fallback, on a real engine.
 */

import { afterEach, describe, expect, it } from "vitest";
import { createEngine } from "@gwenjs/core/node";
import type { GwenEngine } from "@gwenjs/core";
import type { ViewportRegion } from "@gwenjs/renderer-core";
import { GwenApp } from "../src/app.js";
import { resolveLoadedConfig } from "../src/config.js";
import { createViewportsPlugin } from "../src/viewports-plugin.js";

const engines: GwenEngine[] = [];

async function openWith(viewports?: Record<string, ViewportRegion>): Promise<GwenEngine> {
  const engine = await createEngine();
  engines.push(engine);
  await engine.use(createViewportsPlugin(viewports));
  await engine.hooks.callHook("engine:init");
  return engine;
}

afterEach(async () => {
  for (const engine of engines.splice(0)) await engine.stop();
});

describe("createViewportsPlugin", () => {
  it("registers configured viewports on engine:init", async () => {
    const viewports: Record<string, ViewportRegion> = {
      p1: { x: 0, y: 0, width: 0.5, height: 1 },
      p2: { x: 0.5, y: 0, width: 0.5, height: 1 },
    };
    const engine = await openWith(viewports);
    const registered = engine.inject("viewportManager");
    expect(registered.get("p1")?.region).toEqual(viewports.p1);
    expect(registered.get("p2")?.region).toEqual(viewports.p2);
  });

  it("registers default fullscreen 'main' viewport when no config is provided", async () => {
    const engine = await openWith(undefined);
    expect(engine.inject("viewportManager").get("main")?.region).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    });
  });

  it("registers default fullscreen 'main' viewport when empty map is provided", async () => {
    const engine = await openWith({});
    expect(engine.inject("viewportManager").get("main")?.region).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    });
  });

  it("has name 'gwen:viewports'", () => {
    expect(createViewportsPlugin().name).toBe("gwen:viewports");
  });

  it("provides viewportManager, cameraManager and layerManager and registers main", async () => {
    const plugin = createViewportsPlugin();
    const provides: readonly string[] = plugin.provides;
    expect(provides).toEqual(["viewportManager", "cameraManager", "layerManager"]);
    const engine = await openWith();
    expect(engine.inject("viewportManager").get("main")?.region).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    });
  });
});

describe("createViewportsPlugin — idempotence via GwenApp", () => {
  it("setupModules replaces existing gwen:viewports plugin on second call", async () => {
    const app = new GwenApp();
    const config = resolveLoadedConfig({});

    await app.setupModules(config);
    const countAfterFirst = app.plugins.filter((plugin) => plugin.name === "gwen:viewports").length;

    await app.setupModules(config);
    const countAfterSecond = app.plugins.filter(
      (plugin) => plugin.name === "gwen:viewports",
    ).length;

    expect(countAfterFirst).toBe(1);
    expect(countAfterSecond).toBe(1);
  });
});

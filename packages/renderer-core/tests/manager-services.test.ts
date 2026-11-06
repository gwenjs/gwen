/**
 * Declared manager services: gwen:viewports and gwen:screen.
 * Real engines from @gwenjs/core/node, stopped in afterEach.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createEngine } from "@gwenjs/core/node";
import type { GwenEngine } from "@gwenjs/core";
import { definePlugin } from "@gwenjs/kit/plugin";
import type { CameraStateStore, GwenPlugin } from "@gwenjs/schema";
import { getOrCreateCameraManager } from "../src/get-or-create-camera-manager.js";
import { ScreenPlugin } from "../src/screen-plugin.js";
import { createViewportsPlugin } from "../../app/src/viewports-plugin.js";

const engines: GwenEngine[] = [];

async function open(): Promise<GwenEngine> {
  const engine = await createEngine();
  engines.push(engine);
  return engine;
}

afterEach(async () => {
  for (const engine of engines.splice(0)) await engine.stop();
});

function secondCamera(): GwenPlugin {
  return {
    name: "second",
    provides: ["cameraManager"],
    setup() {},
  };
}

const DUPLICATE_WHAT =
  'Plugin "second" provides "cameraManager", already provided by plugin "gwen:viewports".';

const SCREEN_MISSING_WHAT =
  'Plugin "gwen:screen" requires service "viewportManager", which is not installed.';

const LAYERS_MISSING_WHAT =
  'Plugin "needs-layers" requires service "layerManager", which is not installed.';

const CAMERA_NOT_FOUND_WHAT = 'No plugin provides service "cameraManager".';

describe("declared manager services", () => {
  it("gwen:viewports provides viewportManager, cameraManager and layerManager after use()", async () => {
    const plugin = createViewportsPlugin();
    const provides: readonly string[] = plugin.provides;
    expect(provides).toEqual(["viewportManager", "cameraManager", "layerManager"]);
    const engine = await open();
    await engine.use(plugin);
    expect(engine.inject("viewportManager")).toBe(engine.tryInject("viewportManager"));
    expect(engine.inject("cameraManager")).toBe(engine.tryInject("cameraManager"));
    expect(engine.inject("layerManager")).toBe(engine.tryInject("layerManager"));
  });

  it("gwen:screen provides screenService", async () => {
    const plugin = ScreenPlugin();
    const provides: readonly string[] = plugin.provides;
    expect(provides).toEqual(["screenService"]);
    const engine = await open();
    await expect(engine.use(ScreenPlugin())).rejects.toMatchObject({
      code: "CORE:PLUGIN_DEPENDENCY_MISSING",
      message: expect.stringContaining(SCREEN_MISSING_WHAT),
    });
    await engine.use(createViewportsPlugin());
    await engine.use(ScreenPlugin());
    expect(engine.inject("screenService")).toBeDefined();
  });

  it("a second provider of cameraManager rejects CORE:PLUGIN_PROVIDE_DUPLICATE with owner gwen:viewports", async () => {
    const engine = await open();
    await engine.use(createViewportsPlugin());
    await expect(engine.use(secondCamera())).rejects.toMatchObject({
      code: "CORE:PLUGIN_PROVIDE_DUPLICATE",
      owner: "gwen:viewports",
      keys: ["cameraManager"],
      message: expect.stringContaining(DUPLICATE_WHAT),
    });
  });

  it("getOrCreateCameraManager returns the declared service and provides nothing", async () => {
    const engine = await open();
    let caught: unknown;
    try {
      getOrCreateCameraManager(engine);
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({
      code: "CORE:PLUGIN_NOT_FOUND",
      message: expect.stringContaining(CAMERA_NOT_FOUND_WHAT),
    });
    expect(engine.tryInject("cameraManager")).toBeUndefined();

    await engine.use(createViewportsPlugin());
    const declared = engine.inject("cameraManager");
    expect(getOrCreateCameraManager(engine)).toBe(declared);
    await expect(engine.use(secondCamera())).rejects.toMatchObject({
      code: "CORE:PLUGIN_PROVIDE_DUPLICATE",
      owner: "gwen:viewports",
      message: expect.stringContaining(DUPLICATE_WHAT),
    });
  });

  it('a plugin with requires.optional ["cameraManager"] installs on a headless engine without gwen:viewports and reads undefined', async () => {
    const engine = await open();
    let read: CameraStateStore | undefined;
    let reads = 0;
    await engine.use(
      definePlugin({ provides: [] }, () => ({
        name: "reads-camera",
        requires: { optional: ["cameraManager"] },
        setup(host) {
          const pull = (): void => {
            reads += 1;
            read = host.tryInject("cameraManager");
          };
          pull();
          host.hooks.hook("service:provided", (event) => {
            if (event.key === "cameraManager") pull();
          });
        },
      }))(),
    );
    expect(reads).toBe(1);
    expect(read).toBeUndefined();

    await engine.use(createViewportsPlugin());
    expect(read).toBeDefined();
    expect(read).toBe(engine.tryInject("cameraManager"));
  });

  it('a plugin with requires.services ["layerManager"] rejects CORE:PLUGIN_DEPENDENCY_MISSING without gwen:viewports, and installs with it', async () => {
    const engine = await open();
    const needsLayers = (): GwenPlugin =>
      definePlugin({ provides: [] }, () => ({
        name: "needs-layers",
        requires: { services: ["layerManager"] },
        setup() {},
      }))();

    await expect(engine.use(needsLayers())).rejects.toMatchObject({
      code: "CORE:PLUGIN_DEPENDENCY_MISSING",
      message: expect.stringContaining(LAYERS_MISSING_WHAT),
    });

    await engine.use(createViewportsPlugin());
    await expect(engine.use(needsLayers())).resolves.toBeUndefined();
    expect(engine.tryInject("layerManager")).toBeDefined();
  });

  it("two engines get two managers", async () => {
    const left = await open();
    const right = await open();
    await left.use(createViewportsPlugin());
    await right.use(createViewportsPlugin());
    const keys = ["viewportManager", "cameraManager", "layerManager"] as const;
    for (const key of keys) {
      const onLeft = left.tryInject(key);
      const onRight = right.tryInject(key);
      expect(onLeft).toBeDefined();
      expect(onRight).toBeDefined();
      expect(onLeft).not.toBe(onRight);
      expect(onLeft).toBe(left.inject(key));
      expect(onRight).toBe(right.inject(key));
    }
  });

  it("unuse(gwen:viewports) fires service:removed for the three keys", async () => {
    const engine = await open();
    await engine.use(createViewportsPlugin());
    const removed: { key: string; reason: string; owner: string | undefined }[] = [];
    engine.hooks.hook("service:removed", (event) => {
      removed.push({ key: event.key, reason: event.reason, owner: event.owner });
    });
    await engine.unuse("gwen:viewports");
    expect(removed.map((event) => event.key).sort()).toEqual([
      "cameraManager",
      "layerManager",
      "viewportManager",
    ]);
    expect(
      removed.every((event) => event.reason === "unuse" && event.owner === "gwen:viewports"),
    ).toBe(true);
  });

  it("use, unuse, use provides the keys again", async () => {
    const engine = await open();
    await engine.use(createViewportsPlugin());
    const firstCamera = engine.tryInject("cameraManager");
    const firstLayer = engine.tryInject("layerManager");
    const firstViewport = engine.tryInject("viewportManager");
    expect(firstCamera).toBeDefined();
    expect(firstLayer).toBeDefined();
    expect(firstViewport).toBeDefined();
    await engine.unuse("gwen:viewports");
    expect(engine.tryInject("cameraManager")).toBeUndefined();
    expect(engine.tryInject("layerManager")).toBeUndefined();
    expect(engine.tryInject("viewportManager")).toBeUndefined();
    await engine.use(createViewportsPlugin());
    expect(engine.tryInject("cameraManager")).toBeDefined();
    expect(engine.tryInject("cameraManager")).not.toBe(firstCamera);
    expect(engine.tryInject("layerManager")).toBeDefined();
    expect(engine.tryInject("layerManager")).not.toBe(firstLayer);
    expect(engine.tryInject("viewportManager")).toBeDefined();
    expect(engine.tryInject("viewportManager")).not.toBe(firstViewport);
  });
});

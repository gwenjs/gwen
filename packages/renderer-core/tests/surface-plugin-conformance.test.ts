// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { createRealEngine } from "@gwenjs/core/testing";
import type { RealEngineHandle } from "@gwenjs/core/testing";
import { GwenError } from "@gwenjs/schema";
import type { GwenPlugin } from "@gwenjs/schema";
import * as testing from "../src/testing/index.js";
import { RENDERER_CONTRACT_VERSION } from "../src/types.js";
import type { RenderView, RendererService } from "../src/types.js";

/** A service that may or may not be a surface: the suite must tell. */
interface FixtureService extends RendererService {
  renderViews(views: readonly RenderView[], alpha: number): void;
}

declare module "@gwenjs/schema" {
  interface GwenProvides {
    "renderer:fixture": FixtureService;
  }
}

interface PluginConformanceOptions {
  readonly plugin: () => GwenPlugin;
  readonly serviceKey: "renderer:fixture";
  readonly createEngine?: () => Promise<RealEngineHandle>;
}

/** `runSurfacePluginConformance` read by name: the file loads, and fails on an assertion, while it is absent. */
function pluginSuite(): (options: PluginConformanceOptions) => Promise<void> {
  const suite: unknown = Reflect.get(testing, "runSurfacePluginConformance");
  expect(typeof suite, "runSurfacePluginConformance export").toBe("function");
  if (typeof suite !== "function") throw new TypeError("runSurfacePluginConformance is missing");
  return async (options) => {
    const result: unknown = Reflect.apply(suite, undefined, [options]);
    if (!(result instanceof Promise)) throw new TypeError("the suite did not return a promise");
    await result;
  };
}

async function rejectionOf(run: () => Promise<void>): Promise<GwenError> {
  let caught: unknown;
  try {
    await run();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(GwenError);
  if (!(caught instanceof GwenError)) throw new Error("expected GwenError");
  return caught;
}

interface Draw {
  readonly views: number;
  readonly alpha: number;
}

interface Fixture {
  /** Every `renderViews` call that reached the real method, per service. */
  readonly draws: Draw[];
  /** `plugin()` calls. */
  created: number;
}

interface Knobs {
  /** The plugin renders by itself in `engine:render`, next to the host. */
  renderTwice?: boolean;
  /** `unmount()` keeps the canvas and teardown moves it to `document.body`. */
  leaveCanvas?: boolean;
  /** Every `mount()` appends the same canvas element, whatever the engine. */
  shared?: boolean;
  /** The plugin registers its service at `engine:init`, so a later install never registers. */
  registerAtInit?: boolean;
  /** The layer element is a `div`. */
  layerIsDiv?: boolean;
  /** `resize` ignores the dpr. */
  ignoreDpr?: boolean;
  /** `setup` throws. */
  failSetup?: boolean;
  /** The service is a layers renderer. */
  notSurface?: boolean;
  /** Teardown of any instance stops every instance from drawing. */
  stopOthers?: boolean;
  /** The canvas lives in module state: `unmount()` of one engine removes the canvas of another. */
  sharedState?: boolean;
  /** The plugin clears the camera state before `engine:render`. */
  clearCameras?: boolean;
  /** Teardown draws once more. */
  drawAtTeardown?: boolean;
  /** The plugin provides nothing under the key. */
  noService?: boolean;
  /** `teardown()` throws. The host reports it on `engine.errors`. */
  throwOnTeardown?: boolean;
  /** The third `mount()` throws. Engines A and B mount first; the late install is the third. */
  failLateMount?: boolean;
  /** The second engine's `mount()` moves the first engine's canvas to `document.body`. */
  parkFirst?: boolean;
}

let sharedAlive = true;
let sharedCanvas: HTMLCanvasElement | undefined;
let currentCanvas: HTMLElement | null = null;
let mountsSeen = 0;
let parkedCanvas: HTMLElement | null = null;

function surfacePlugin(fixture: Fixture, knobs: Knobs = {}): () => GwenPlugin {
  const build = (): GwenPlugin => {
    fixture.created += 1;
    let canvas: HTMLElement | null = null;
    const service: FixtureService = {
      name: "renderer:fixture",
      contractVersion: RENDERER_CONTRACT_VERSION,
      kind: knobs.notSurface === true ? "layers" : "surface",
      layers: { scene: { order: 0, coordinate: "world" } },
      mount(container) {
        mountsSeen += 1;
        if (knobs.failLateMount === true && mountsSeen === 3)
          throw new Error("late mount exploded");
        if (knobs.shared === true) {
          sharedCanvas ??= container.ownerDocument.createElement("canvas");
          canvas = sharedCanvas;
        } else {
          canvas = container.ownerDocument.createElement(
            knobs.layerIsDiv === true ? "div" : "canvas",
          );
        }
        container.appendChild(canvas);
        if (parkedCanvas === null) parkedCanvas = canvas;
        else if (knobs.parkFirst === true) document.body.appendChild(parkedCanvas);
        currentCanvas = canvas;
      },
      unmount() {
        if (knobs.leaveCanvas === true) return;
        if (knobs.sharedState === true) currentCanvas?.remove();
        canvas?.remove();
        canvas = null;
      },
      resize(width, height, dpr) {
        if (!(canvas instanceof HTMLCanvasElement)) return;
        const ratio = knobs.ignoreDpr === true ? 1 : dpr;
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
      },
      getLayerElement() {
        if (canvas === null) throw new Error("canvas is created in mount()");
        return canvas;
      },
      renderViews(views, alpha) {
        if (knobs.stopOthers === true && !sharedAlive) throw new Error("renderer disposed");
        fixture.draws.push({ views: views.length, alpha });
      },
    };
    return {
      name: "plugin:fixture",
      provides: knobs.noService === true ? [] : ["renderer:fixture"],
      requires: { services: ["layerManager"] },
      setup(engine) {
        if (knobs.failSetup === true) throw new Error("setup exploded");
        if (knobs.noService !== true) engine.provide("renderer:fixture", service);
        const layers = engine.inject("layerManager");
        if (knobs.registerAtInit === true) {
          engine.hooks.hook("engine:init", () => {
            layers.register(service);
          });
        } else {
          layers.register(service);
        }
        if (knobs.clearCameras === true) {
          const cameras = engine.inject("cameraManager");
          engine.hooks.hook("engine:after-update", () => {
            cameras.clearFrame();
          });
        }
        if (knobs.renderTwice === true) {
          engine.hooks.hook("engine:render", () => {
            service.renderViews([], 0);
          });
        }
      },
      teardown() {
        if (knobs.throwOnTeardown === true) throw new Error("teardown exploded");
        if (knobs.leaveCanvas === true && canvas !== null) document.body.appendChild(canvas);
        if (knobs.stopOthers === true) sharedAlive = false;
        if (knobs.drawAtTeardown === true) service.renderViews([], 0);
      },
    };
  };
  return build;
}

function fixture(): Fixture {
  return { draws: [], created: 0 };
}

interface Tracker {
  created: number;
  disposed: number;
  readonly createEngine: () => Promise<RealEngineHandle>;
}

function tracker(): Tracker {
  const log = {
    created: 0,
    disposed: 0,
    async createEngine(): Promise<RealEngineHandle> {
      const handle = await createRealEngine({ variant: "light", maxEntities: 64, physicsHz: 60 });
      log.created += 1;
      return {
        ...handle,
        async dispose() {
          await handle.dispose();
          log.disposed += 1;
        },
      };
    },
  };
  return log;
}

const leftover = (): number => document.querySelectorAll("canvas").length;

afterEach(() => {
  sharedAlive = true;
  sharedCanvas = undefined;
  currentCanvas = null;
  mountsSeen = 0;
  parkedCanvas = null;
  document.body.replaceChildren();
});

describe("runSurfacePluginConformance", () => {
  it("passes a well-behaved surface plugin", async () => {
    const run = pluginSuite();
    const probe = fixture();
    await run({ plugin: surfacePlugin(probe), serviceKey: "renderer:fixture" });
    const views = new Set(probe.draws.map((draw) => draw.views));
    expect([...views].sort()).toEqual([0, 1, 2]);
    expect(probe.draws.some((draw) => draw.alpha === 0.5)).toBe(true);
    expect(probe.created).toBe(3);
    expect(leftover()).toBe(0);
    expect(document.body.children).toHaveLength(0);
  });

  it("fails a plugin that renders twice per engine:render", async () => {
    const run = pluginSuite();
    const error = await rejectionOf(() =>
      run({
        plugin: surfacePlugin(fixture(), { renderTwice: true }),
        serviceKey: "renderer:fixture",
      }),
    );
    expect(error.code).toBe("RENDERER:CONFORMANCE_FAILED");
    expect(error.composable).toBe("runSurfacePluginConformance");
    expect(error.message).toContain("renderViews");
    expect(error.message).toContain("2 times in 1 frames");
    expect(error.message).toContain("expected 1");
    expect(error.message.slice("[runSurfacePluginConformance()] ".length)).not.toContain("[");
  });

  it("fails a plugin that leaves its canvas after stop", async () => {
    const run = pluginSuite();
    const error = await rejectionOf(() =>
      run({
        plugin: surfacePlugin(fixture(), { leaveCanvas: true }),
        serviceKey: "renderer:fixture",
      }),
    );
    expect(error.code).toBe("RENDERER:CONFORMANCE_FAILED");
    expect(error.message).toContain("canvas");
    expect(error.message).toContain("engine.stop()");
  });

  it("fails a plugin that shares one canvas across two engines", async () => {
    const run = pluginSuite();
    const error = await rejectionOf(() =>
      run({
        plugin: surfacePlugin(fixture(), { shared: true }),
        serviceKey: "renderer:fixture",
      }),
    );
    expect(error.code).toBe("RENDERER:CONFORMANCE_FAILED");
    expect(error.message).toContain("two engines");
  });

  it("fails a plugin that is not mounted when installed after start", async () => {
    const run = pluginSuite();
    const error = await rejectionOf(() =>
      run({
        plugin: surfacePlugin(fixture(), { registerAtInit: true }),
        serviceKey: "renderer:fixture",
      }),
    );
    expect(error.code).toBe("RENDERER:CONFORMANCE_FAILED");
    expect(error.message).toContain("installed after start");
    expect(error.message).toContain("renderer:fixture:");
  });

  it("fails a plugin whose teardown stops the renderer of another engine", async () => {
    const run = pluginSuite();
    const error = await rejectionOf(() =>
      run({
        plugin: surfacePlugin(fixture(), { stopOthers: true }),
        serviceKey: "renderer:fixture",
      }),
    );
    expect(error.code).toBe("RENDERER:CONFORMANCE_FAILED");
    expect(error.message).toContain("second engine");
    expect(error.message).toContain("after the first one stopped");
  });

  it("fails a plugin whose unmount removes the canvas of another engine", async () => {
    const run = pluginSuite();
    const error = await rejectionOf(() =>
      run({
        plugin: surfacePlugin(fixture(), { sharedState: true }),
        serviceKey: "renderer:fixture",
      }),
    );
    expect(error.code).toBe("RENDERER:CONFORMANCE_FAILED");
    expect(error.message).toContain("disconnected the canvas of the second engine");
  });

  it("fails a plugin that clears the camera state before engine:render", async () => {
    const run = pluginSuite();
    const error = await rejectionOf(() =>
      run({
        plugin: surfacePlugin(fixture(), { clearCameras: true }),
        serviceKey: "renderer:fixture",
      }),
    );
    expect(error.code).toBe("RENDERER:CONFORMANCE_FAILED");
    expect(error.message).toContain("got 0 views, expected 1");
  });

  it("fails a plugin that still renders after stop", async () => {
    const run = pluginSuite();
    const error = await rejectionOf(() =>
      run({
        plugin: surfacePlugin(fixture(), { drawAtTeardown: true }),
        serviceKey: "renderer:fixture",
      }),
    );
    expect(error.code).toBe("RENDERER:CONFORMANCE_FAILED");
    expect(error.message).toContain("after engine.stop()");
    expect(error.message).toContain("renderViews");
  });

  it("fails a plugin whose layer element is not a canvas", async () => {
    const run = pluginSuite();
    const error = await rejectionOf(() =>
      run({
        plugin: surfacePlugin(fixture(), { layerIsDiv: true }),
        serviceKey: "renderer:fixture",
      }),
    );
    expect(error.code).toBe("RENDERER:CONFORMANCE_FAILED");
    expect(error.message).toContain("HTMLCanvasElement");
  });

  it("fails a plugin whose canvas ignores the dpr of a size change", async () => {
    const run = pluginSuite();
    const error = await rejectionOf(() =>
      run({
        plugin: surfacePlugin(fixture(), { ignoreDpr: true }),
        serviceKey: "renderer:fixture",
      }),
    );
    expect(error.code).toBe("RENDERER:CONFORMANCE_FAILED");
    expect(error.message).toContain("dpr");
    expect(error.message).toContain("1920x1080");
  });

  it("fails a plugin whose service is not a surface renderer", async () => {
    const run = pluginSuite();
    const error = await rejectionOf(() =>
      run({
        plugin: surfacePlugin(fixture(), { notSurface: true }),
        serviceKey: "renderer:fixture",
      }),
    );
    expect(error.code).toBe("RENDERER:CONFORMANCE_FAILED");
    expect(error.message).toContain("renderer:fixture");
    expect(error.message).toContain("surface");
  });

  it("fails a plugin that provides nothing under serviceKey", async () => {
    const run = pluginSuite();
    const error = await rejectionOf(() =>
      run({
        plugin: surfacePlugin(fixture(), { noService: true }),
        serviceKey: "renderer:fixture",
      }),
    );
    expect(error.code).toBe("RENDERER:CONFORMANCE_FAILED");
    expect(error.message).toContain("renderer:fixture");
  });

  it("fails a plugin whose install is rejected and keeps the cause", async () => {
    const run = pluginSuite();
    const error = await rejectionOf(() =>
      run({
        plugin: surfacePlugin(fixture(), { failSetup: true }),
        serviceKey: "renderer:fixture",
      }),
    );
    expect(error.code).toBe("RENDERER:CONFORMANCE_FAILED");
    expect(error.message).toContain("setup exploded");
    expect(error.cause).toBeInstanceOf(Error);
  });

  it("runs on the engines of createEngine and disposes each of them", async () => {
    const run = pluginSuite();
    const engines = tracker();
    await run({
      plugin: surfacePlugin(fixture()),
      serviceKey: "renderer:fixture",
      createEngine: engines.createEngine,
    });
    expect(engines.created).toBe(3);
    expect(engines.disposed).toBe(3);
  });

  it("disposes every engine and removes every container when a check fails", async () => {
    const run = pluginSuite();
    const engines = tracker();
    const before = document.body.children.length;
    await rejectionOf(() =>
      run({
        plugin: surfacePlugin(fixture(), { shared: true }),
        serviceKey: "renderer:fixture",
        createEngine: engines.createEngine,
      }),
    );
    expect(engines.created).toBeGreaterThan(0);
    expect(engines.disposed).toBe(engines.created);
    expect(document.body.children).toHaveLength(before);
    expect(leftover()).toBe(0);
  });

  it("fails a plugin whose teardown throws", async () => {
    const run = pluginSuite();
    const error = await rejectionOf(() =>
      run({
        plugin: surfacePlugin(fixture(), { throwOnTeardown: true }),
        serviceKey: "renderer:fixture",
      }),
    );
    expect(error.code).toBe("RENDERER:CONFORMANCE_FAILED");
    expect(error.message).toContain("CORE:PLUGIN_RUNTIME_ERROR");
    expect(error.message).toContain("(plugin:fixture)");
    expect(error.message).toContain("teardown exploded");
    expect(error.message.slice("[runSurfacePluginConformance()] ".length)).not.toContain("[");
  });

  it("fails a plugin whose mount throws when installed after start", async () => {
    const run = pluginSuite();
    const error = await rejectionOf(() =>
      run({
        plugin: surfacePlugin(fixture(), { failLateMount: true }),
        serviceKey: "renderer:fixture",
      }),
    );
    expect(error.code).toBe("RENDERER:CONFORMANCE_FAILED");
    expect(error.message).toContain("RENDERER:MOUNT_FAILED");
    expect(error.message).toContain("late mount exploded");
    expect(error.message).not.toContain("found 0");
  });

  it("fails a plugin that moves its canvas outside the host root", async () => {
    const run = pluginSuite();
    const error = await rejectionOf(() =>
      run({
        plugin: surfacePlugin(fixture(), { parkFirst: true }),
        serviceKey: "renderer:fixture",
      }),
    );
    expect(error.code).toBe("RENDERER:CONFORMANCE_FAILED");
    expect(error.message).toContain("host root");
  });

  it("disposes every engine when the first dispose() rejects", async () => {
    const run = pluginSuite();
    const pending: RealEngineHandle[] = [];
    let created = 0;
    let disposed = 0;
    let calls = 0;
    const before = document.body.children.length;
    const createEngine = async (): Promise<RealEngineHandle> => {
      const handle = await createRealEngine({ variant: "light", maxEntities: 64, physicsHz: 60 });
      created += 1;
      pending.push(handle);
      return {
        ...handle,
        async dispose() {
          calls += 1;
          const rejectFirst = calls === 1;
          await handle.dispose();
          disposed += 1;
          const index = pending.indexOf(handle);
          if (index !== -1) pending.splice(index, 1);
          if (rejectFirst) throw new Error("dispose failed");
        },
      };
    };
    let caught: unknown;
    try {
      await run({
        plugin: surfacePlugin(fixture()),
        serviceKey: "renderer:fixture",
        createEngine,
      });
    } catch (error) {
      caught = error;
    } finally {
      for (const handle of pending) await handle.dispose();
    }
    expect(caught).toBeInstanceOf(Error);
    expect(disposed).toBe(created);
    expect(document.body.children).toHaveLength(before);
    expect(leftover()).toBe(0);
  });
});

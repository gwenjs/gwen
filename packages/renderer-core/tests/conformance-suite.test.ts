// @vitest-environment happy-dom
import { afterEach, describe, it, expect, vi } from "vitest";
import { createEngine } from "@gwenjs/core/node";
import { GwenError } from "@gwenjs/schema";
import type { CameraState, GwenPlugin } from "@gwenjs/schema";
import { runConformanceTests, runSurfaceConformance } from "../src/testing/index.js";
import * as testing from "../src/testing/index.js";
import { RendererErrorCodes } from "../src/errors.js";
import type { RendererService, SurfaceRendererService } from "../src/types.js";
import { RENDERER_CONTRACT_VERSION } from "../src/types.js";
import { createManagerServices } from "../src/create-manager-services.js";
import { ScreenServiceImpl } from "../src/screen-service.js";
import { ScreenPlugin } from "../src/screen-plugin.js";
import { RenderHostPlugin } from "../src/render-host-plugin.js";
import type { GwenEngine, GwenLogger } from "@gwenjs/core";

function makeCompliantService(): RendererService {
  const elements: Record<string, HTMLElement> = {};
  return {
    name: "renderer:test",
    contractVersion: RENDERER_CONTRACT_VERSION,
    layers: { main: { order: 0 } },
    mount: vi.fn(),
    unmount: vi.fn(),
    resize: vi.fn(),
    getLayerElement: vi.fn((name: string) => {
      if (!elements[name]) elements[name] = document.createElement("div");
      return elements[name]!;
    }),
    setStatsCollector: vi.fn(),
  };
}

describe("runConformanceTests", () => {
  it("passes for a fully compliant service", () => {
    expect(() => runConformanceTests(makeCompliantService())).not.toThrow();
  });

  it("fails when contractVersion is wrong", () => {
    const svc = { ...makeCompliantService(), contractVersion: 999 };
    expect(() => runConformanceTests(svc)).toThrow();
  });

  it("fails when layers is empty", () => {
    const svc = { ...makeCompliantService(), layers: {} };
    expect(() => runConformanceTests(svc)).toThrow();
  });

  it("fails when getLayerElement throws for a declared layer", () => {
    const cause = new Error("not found");
    const svc = {
      ...makeCompliantService(),
      getLayerElement() {
        throw cause;
      },
    };
    expect(thrownBy(() => runConformanceTests(svc)).cause).toBe(cause);
  });

  it("fails when getLayerElement does not return an Element", () => {
    const svc = {
      ...makeCompliantService(),
      name: "renderer:bad-element",
      getLayerElement(): HTMLElement {
        const node = document.createElement("div");
        Object.setPrototypeOf(node, null);
        return node;
      },
    };
    const error = thrownBy(() => runConformanceTests(svc));
    expect(error.code).toBe("RENDERER:CONFORMANCE_FAILED");
    expect(error.composable).toBe("runConformanceTests");
    expect(error.message).toContain("renderer:bad-element");
    expect(error.message).not.toContain("threw");
  });

  it("fails when mount is not a function", () => {
    const svc = { ...makeCompliantService(), mount: "not-a-function" as unknown as () => void };
    expect(() => runConformanceTests(svc)).toThrow();
  });

  it("fails when resize is not a function", () => {
    const svc = { ...makeCompliantService(), resize: null as unknown as () => void };
    expect(() => runConformanceTests(svc)).toThrow();
  });

  it("does not call mount() or unmount() during conformance check", () => {
    const svc = makeCompliantService();
    runConformanceTests(svc);
    expect(svc.mount).not.toHaveBeenCalled();
    expect(svc.unmount).not.toHaveBeenCalled();
  });
});

function makeEngine(): GwenEngine {
  const services = new Map<string, unknown>();
  const childLogger: GwenLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };
  const logger: GwenLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnValue(childLogger),
  };
  return {
    logger,
    provide: vi.fn((key: string, value: unknown) => {
      services.set(key, value);
    }),
    tryInject: vi.fn((key: string) => services.get(key)),
    inject: (key: string) => {
      const value = services.get(key);
      if (value === undefined) throw new Error(`No plugin provides service "${key}".`);
      return value;
    },
    hooks: { hook: vi.fn(), callHook: vi.fn() },
  } as unknown as GwenEngine;
}

function declareManagers(engine: GwenEngine): void {
  const created = createManagerServices(engine);
  engine.provide("viewportManager", created.viewportManager);
  engine.provide("cameraManager", created.cameraManager);
  engine.provide("layerManager", created.layerManager);
  engine.provide(
    "screenService",
    new ScreenServiceImpl(engine.logger.child("renderer-core:screen"), created.viewportManager),
  );
}

let screenDpr = 2;

function makeSurface(mutate?: (service: SurfaceRendererService) => void): SurfaceRendererService {
  const canvas = document.createElement("canvas");
  const service: SurfaceRendererService = {
    name: "renderer:surface",
    contractVersion: RENDERER_CONTRACT_VERSION,
    kind: "surface",
    layers: { scene: { order: 0, coordinate: "world" } },
    mount(container) {
      container.appendChild(canvas);
    },
    unmount() {
      canvas.remove();
    },
    resize(width, height) {
      canvas.width = Math.round(width * screenDpr);
      canvas.height = Math.round(height * screenDpr);
    },
    getLayerElement() {
      return canvas;
    },
    renderViews() {},
  };
  mutate?.(service);
  return service;
}

describe("runSurfaceConformance", () => {
  it("passes a surface renderer and calls renderViews with 0, 1, and 2 views", () => {
    const engine = makeEngine();
    declareManagers(engine);
    screenDpr = 2;
    const viewports = engine.inject("viewportManager");
    viewports.set("main", { x: 0, y: 0, width: 1, height: 1 });
    engine.inject("screenService").setContainerSize(800, 600, screenDpr);

    const seen: number[] = [];
    const alphas: number[] = [];
    const service = makeSurface((svc) => {
      svc.renderViews = (views, alpha) => {
        seen.push(views.length);
        alphas.push(alpha);
      };
    });

    expect(() => runSurfaceConformance(service, engine)).not.toThrow();
    expect(seen).toEqual([0, 1, 2]);
    expect(alphas).toEqual([0, 0.5, 1]);
    expect(RENDERER_CONTRACT_VERSION).toBe(2);
  });

  it("passes a surface that creates its canvas in mount", () => {
    const engine = makeEngine();
    declareManagers(engine);
    screenDpr = 2;
    engine.inject("viewportManager").set("main", { x: 0, y: 0, width: 1, height: 1 });
    engine.inject("screenService").setContainerSize(800, 600, screenDpr);
    let canvas: HTMLCanvasElement | null = null;
    const service = makeSurface((svc) => {
      svc.mount = (container) => {
        canvas = document.createElement("canvas");
        container.appendChild(canvas);
      };
      svc.unmount = () => {
        canvas?.remove();
        canvas = null;
      };
      svc.getLayerElement = () => {
        if (canvas === null) throw new Error("canvas is created in mount()");
        return canvas;
      };
      svc.resize = (width, height) => {
        if (canvas === null) throw new Error("resize before mount");
        canvas.width = Math.round(width * screenDpr);
        canvas.height = Math.round(height * screenDpr);
      };
    });
    expect(() => runSurfaceConformance(service, engine)).not.toThrow();
  });

  it("sizes the canvas from the third resize argument only", async () => {
    const engine = await createEngine({ maxEntities: 32 });
    try {
      await engine.use(RenderHostPlugin());
      await engine.use(ScreenPlugin());
      engine.inject("viewportManager").set("main", { x: 0, y: 0, width: 1, height: 1 });
      engine.inject("screenService").setContainerSize(800, 600, 3);
      const service = makeSurface((svc) => {
        svc.resize = (width, height, dpr = 1) => {
          const canvas = svc.getLayerElement("scene");
          if (!(canvas instanceof HTMLCanvasElement)) return;
          canvas.width = Math.round(width * dpr);
          canvas.height = Math.round(height * dpr);
        };
      });
      let thrown: unknown;
      try {
        runSurfaceConformance(service, engine);
      } catch (error) {
        thrown = error;
      }
      const canvas = service.getLayerElement("scene");
      expect(canvas instanceof HTMLCanvasElement ? canvas.width : 0).toBe(960);
      expect(canvas instanceof HTMLCanvasElement ? canvas.height : 0).toBe(540);
      expect(thrown).toBeUndefined();
    } finally {
      await engine.stop();
    }
  });

  it("fails when the canvas stays attached after unmount", () => {
    const engine = makeEngine();
    declareManagers(engine);
    engine.inject("viewportManager").set("main", { x: 0, y: 0, width: 1, height: 1 });
    engine.inject("screenService").setContainerSize(800, 600, 2);
    const service = makeSurface((svc) => {
      svc.unmount = () => {};
    });
    expect(() => runSurfaceConformance(service, engine)).toThrow(/unmount/);
  });

  it("fails when resize ignores dpr", () => {
    const engine = makeEngine();
    declareManagers(engine);
    screenDpr = 2;
    engine.inject("viewportManager").set("main", { x: 0, y: 0, width: 1, height: 1 });
    engine.inject("screenService").setContainerSize(800, 600, 2);
    const service = makeSurface((svc) => {
      svc.resize = (width, height) => {
        const canvas = svc.getLayerElement("scene");
        canvas.width = width;
        canvas.height = height;
      };
    });
    expect(() => runSurfaceConformance(service, engine)).toThrow(/dpr/);
  });

  it("fails when renderViews throws for 2 views", () => {
    const engine = makeEngine();
    declareManagers(engine);
    engine.inject("viewportManager").set("main", { x: 0, y: 0, width: 1, height: 1 });
    engine.inject("screenService").setContainerSize(800, 600, 2);
    const service = makeSurface((svc) => {
      svc.renderViews = (views) => {
        if (views.length === 2) throw new Error("nope");
      };
    });
    expect(() => runSurfaceConformance(service, engine)).toThrow(/2 views/);
  });

  it("fails when kind is not surface", () => {
    const engine = makeEngine();
    declareManagers(engine);
    const service = makeSurface();
    (service as { kind: "layers" }).kind = "layers";
    expect(() => runSurfaceConformance(service, engine)).toThrow(/surface/);
  });
});

function thrownBy(run: () => void): GwenError {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(GwenError);
  if (!(caught instanceof GwenError)) throw new Error("expected GwenError");
  return caught;
}

describe("conformance error grammar", () => {
  it("a failing check throws RENDERER:CONFORMANCE_FAILED naming runConformanceTests", () => {
    const error = thrownBy(() =>
      runConformanceTests({ ...makeCompliantService(), contractVersion: 999 }),
    );
    expect(error.code).toBe(RendererErrorCodes.CONFORMANCE_FAILED);
    expect(error.code).toBe("RENDERER:CONFORMANCE_FAILED");
    expect(error.composable).toBe("runConformanceTests");
    expect(error.message.startsWith("[runConformanceTests()] ")).toBe(true);
    expect(error.message).not.toContain("[run" + "ConformanceTests] ");
    if (__GWEN_DEV__) {
      expect(error.hint).toBe(
        "Update the renderer plugin or @gwenjs/renderer-core to matching versions.",
      );
      expect(error.message).toContain(`\nFix: ${error.hint}`);
    } else {
      expect(error.hint).toBeUndefined();
      expect(error.message).not.toContain("Fix:");
    }
  });

  it("a failing surface check throws RENDERER:CONFORMANCE_FAILED naming runSurfaceConformance", async () => {
    const engine = await createEngine({ maxEntities: 4 });
    try {
      const service = makeSurface((svc) => {
        svc.resize = () => {};
      });
      const error = thrownBy(() => runSurfaceConformance(service, engine));
      expect(error.code).toBe(RendererErrorCodes.CONFORMANCE_FAILED);
      expect(error.composable).toBe("runSurfaceConformance");
      expect(error.message.startsWith("[runSurfaceConformance()] ")).toBe(true);
      expect(error.message).not.toContain("[runSurfaceConformance] ");
    } finally {
      await engine.stop();
    }
  });
});

const openEngines: GwenEngine[] = [];

afterEach(async () => {
  while (openEngines.length > 0) await openEngines.pop()?.stop();
});

function cameraState(x: number): CameraState {
  return {
    worldTransform: {
      position: { x, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
    },
    projection: { type: "orthographic", zoom: 1, near: -1, far: 1 },
    viewportId: "main",
    active: true,
    priority: 0,
  };
}

type CameraProviderRun = (
  engine: GwenEngine,
  options: { readonly viewportId: string; readonly dt?: number },
) => Promise<void>;

function providerSuite(): CameraProviderRun {
  const suite: unknown = Reflect.get(testing, "runCameraProviderConformance");
  expect(typeof suite).toBe("function");
  if (typeof suite !== "function") {
    throw new Error("runCameraProviderConformance is not a function");
  }
  return async (engine, options) => {
    const result: unknown = Reflect.apply(suite, undefined, [engine, options]);
    if (!(result instanceof Promise)) {
      throw new Error("runCameraProviderConformance did not return a promise");
    }
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

function listenerCount(engine: GwenEngine, name: string): number {
  const list: unknown = Reflect.get(Reflect.get(engine.hooks, "_hooks"), name);
  return Array.isArray(list) ? list.length : 0;
}

async function openHosted(): Promise<GwenEngine> {
  const engine = await createEngine({ maxEntities: 8 });
  openEngines.push(engine);
  await engine.use(RenderHostPlugin());
  return engine;
}

async function openBare(): Promise<GwenEngine> {
  const engine = await createEngine({ maxEntities: 8 });
  openEngines.push(engine);
  return engine;
}

function writeAfterUpdate(): GwenPlugin {
  return {
    name: "write-after-update",
    setup(engine) {
      const cameras = engine.inject("cameraManager");
      engine.hooks.hook("engine:after-update", () => {
        cameras.set("main", cameraState(7));
      });
    },
  };
}

function writeOnRender(): GwenPlugin {
  return {
    name: "write-on-render",
    setup(engine) {
      const cameras = engine.inject("cameraManager");
      engine.hooks.hook("engine:render", () => {
        cameras.set("main", cameraState(7));
      });
    },
  };
}

function writeThenClear(): GwenPlugin {
  return {
    name: "write-then-clear",
    setup(engine) {
      const cameras = engine.inject("cameraManager");
      engine.hooks.hook("engine:after-update", () => {
        cameras.set("main", cameraState(7));
      });
      engine.hooks.hook("engine:render", () => {
        cameras.clearFrame();
      });
    },
  };
}

function pauseAfterUpdate(gate: Promise<void>): GwenPlugin {
  return {
    name: "pause-after-update",
    setup(engine) {
      const cameras = engine.inject("cameraManager");
      engine.hooks.hook("engine:after-update", async () => {
        cameras.set("main", cameraState(7));
        await gate;
      });
    },
  };
}

function recordDt(dts: number[]): GwenPlugin {
  return {
    name: "record-dt",
    setup(engine) {
      const cameras = engine.inject("cameraManager");
      engine.hooks.hook("engine:after-update", (dt) => {
        dts.push(dt);
        cameras.set("main", cameraState(7));
      });
    },
  };
}

const silentProvider: GwenPlugin = {
  name: "silent-provider",
  setup() {},
};

describe("runCameraProviderConformance", () => {
  it("a camera provider writes state no later than engine:after-update", async () => {
    const run = providerSuite();
    const engine = await openHosted();
    await engine.use(writeAfterUpdate());
    await run(engine, { viewportId: "main" });
    expect(engine.inject("cameraManager").get("main")?.worldTransform.position.x).toBe(7);
  });

  it("a provider writing in engine:render rejects RENDERER:CONFORMANCE_FAILED naming engine:after-update", async () => {
    const run = providerSuite();
    const engine = await openHosted();
    await engine.use(writeOnRender());
    const error = await rejectionOf(() => run(engine, { viewportId: "main" }));
    expect(error.code).toBe("RENDERER:CONFORMANCE_FAILED");
    expect(error.composable).toBe("runCameraProviderConformance");
    expect(error.message).toContain("engine:after-update");
    expect(error.message).toContain('"main"');
    expect(error.message).toContain("The provider wrote it later, in engine:render.");
    if (__GWEN_DEV__) expect(typeof error.hint).toBe("string");
    else expect(error.hint).toBeUndefined();
  });

  it("a provider that writes nothing rejects naming the viewport", async () => {
    const run = providerSuite();
    const engine = await openHosted();
    await engine.use(silentProvider);
    const error = await rejectionOf(() => run(engine, { viewportId: "main" }));
    expect(error.code).toBe("RENDERER:CONFORMANCE_FAILED");
    expect(error.message).toContain('"main"');
    expect(error.message).not.toContain("wrote it later");
  });

  it("a state left by an earlier frame does not satisfy a late provider", async () => {
    const run = providerSuite();
    const engine = await openHosted();
    await engine.use(writeOnRender());
    await engine.advance(1 / 60);
    const error = await rejectionOf(() => run(engine, { viewportId: "main" }));
    expect(error.code).toBe("RENDERER:CONFORMANCE_FAILED");
    expect(error.message).toContain("after engine:after-update");
  });

  it("a state cleared between engine:after-update and engine:render rejects naming engine:render", async () => {
    const run = providerSuite();
    const engine = await openHosted();
    await engine.use(writeThenClear());
    const error = await rejectionOf(() => run(engine, { viewportId: "main" }));
    expect(error.code).toBe("RENDERER:CONFORMANCE_FAILED");
    expect(error.message).toContain("engine:render");
    expect(error.message).not.toContain("after engine:after-update");
  });

  it("the frame step is 1/60 by default and options.dt replaces it", async () => {
    const run = providerSuite();
    const dts: number[] = [];
    const engine = await openHosted();
    await engine.use(recordDt(dts));
    await run(engine, { viewportId: "main" });
    await run(engine, { viewportId: "main", dt: 0.05 });
    expect(dts).toEqual([1 / 60, 0.05]);
  });

  it("a run leaves the engine:after-update and engine:render listener counts unchanged", async () => {
    const run = providerSuite();
    const engine = await openHosted();
    await engine.use(writeAfterUpdate());
    const before = [
      listenerCount(engine, "engine:after-update"),
      listenerCount(engine, "engine:render"),
    ];
    expect(before[0]).toBeGreaterThan(0);
    await run(engine, { viewportId: "main" });
    expect([
      listenerCount(engine, "engine:after-update"),
      listenerCount(engine, "engine:render"),
    ]).toEqual(before);
  });

  it("a run during another advance rejects the engine error and leaves the listener counts unchanged", async () => {
    const run = providerSuite();
    const engine = await openHosted();
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await engine.use(pauseAfterUpdate(gate));
    const before = [
      listenerCount(engine, "engine:after-update"),
      listenerCount(engine, "engine:render"),
    ];
    expect(before[0]).toBeGreaterThan(0);
    const outer = engine.advance(1 / 60);
    try {
      const error = await rejectionOf(() => run(engine, { viewportId: "main" }));
      expect(error.code).toBe("CORE:ADVANCE_REENTRANT");
      expect(error.message).toContain(
        "advance() called re-entrantly — only one advance per frame.",
      );
      expect([
        listenerCount(engine, "engine:after-update"),
        listenerCount(engine, "engine:render"),
      ]).toEqual(before);
    } finally {
      release();
      await outer;
    }
  });

  it("an engine without cameraManager rejects naming the service", async () => {
    const run = providerSuite();
    const engine = await openBare();
    const error = await rejectionOf(() => run(engine, { viewportId: "main" }));
    expect(error.code).toBe("RENDERER:CONFORMANCE_FAILED");
    expect(error.message).toContain("cameraManager");
  });

  it("two engines are checked independently", async () => {
    const run = providerSuite();
    const engineA = await openHosted();
    const engineB = await openHosted();
    await engineA.use(writeAfterUpdate());
    await engineB.use(writeOnRender());
    await run(engineA, { viewportId: "main" });
    const error = await rejectionOf(() => run(engineB, { viewportId: "main" }));
    expect(error.code).toBe("RENDERER:CONFORMANCE_FAILED");
    expect(engineA.inject("cameraManager").get("main")?.worldTransform.position.x).toBe(7);
  });
});

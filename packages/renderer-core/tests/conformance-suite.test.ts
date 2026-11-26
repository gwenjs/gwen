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
import { RenderHostPlugin } from "../src/render-host-plugin.js";
import type { GwenEngine } from "@gwenjs/core";

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

function makeSurface(mutate?: (service: SurfaceRendererService) => void): SurfaceRendererService {
  let canvas: HTMLCanvasElement | null = null;
  const service: SurfaceRendererService = {
    name: "renderer:surface",
    contractVersion: RENDERER_CONTRACT_VERSION,
    kind: "surface",
    layers: { scene: { order: 0, coordinate: "world" } },
    mount(container) {
      canvas = document.createElement("canvas");
      container.appendChild(canvas);
    },
    unmount() {
      canvas?.remove();
      canvas = null;
    },
    resize(width, height, dpr = 1) {
      if (canvas === null) return;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    },
    getLayerElement() {
      if (canvas === null) throw new Error("canvas is created in mount()");
      return canvas;
    },
    renderViews() {},
  };
  mutate?.(service);
  return service;
}

describe("runSurfaceConformance", () => {
  it("passes a surface renderer and calls renderViews with 0, 1, and 2 views", () => {
    const seen: number[] = [];
    const alphas: number[] = [];
    const service = makeSurface((svc) => {
      svc.renderViews = (views, alpha) => {
        seen.push(views.length);
        alphas.push(alpha);
      };
    });

    expect(() => runSurfaceConformance(service)).not.toThrow();
    expect(seen).toEqual([0, 1, 2]);
    expect(alphas).toEqual([0, 0.5, 1]);
    expect(RENDERER_CONTRACT_VERSION).toBe(2);
  });

  it("passes a surface that creates its canvas in mount", () => {
    expect(() => runSurfaceConformance(makeSurface())).not.toThrow();
  });

  it("sizes the canvas from the third resize argument only", () => {
    const sizes: Array<[number, number]> = [];
    const service = makeSurface((svc) => {
      svc.resize = (width, height, dpr = 1) => {
        const canvas = svc.getLayerElement("scene");
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        sizes.push([canvas.width, canvas.height]);
      };
    });
    runSurfaceConformance(service, { dpr: 3 });
    expect(sizes).toEqual([
      [960, 540],
      [960, 540],
    ]);
  });

  it("fails when the canvas stays attached after unmount", () => {
    const service = makeSurface((svc) => {
      svc.unmount = () => {};
    });
    expect(() => runSurfaceConformance(service)).toThrow(/unmount/);
  });

  it("fails when resize ignores dpr", () => {
    const service = makeSurface((svc) => {
      svc.resize = (width, height) => {
        const canvas = svc.getLayerElement("scene");
        canvas.width = width;
        canvas.height = height;
      };
    });
    expect(() => runSurfaceConformance(service)).toThrow(/dpr/);
  });

  it("fails when renderViews throws for 2 views", () => {
    const service = makeSurface((svc) => {
      svc.renderViews = (views) => {
        if (views.length === 2) throw new Error("nope");
      };
    });
    expect(() => runSurfaceConformance(service)).toThrow(/2 views/);
  });

  it("fails when kind is not surface", () => {
    const service = makeSurface();
    (service as { kind: "layers" }).kind = "layers";
    expect(() => runSurfaceConformance(service)).toThrow(/surface/);
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

  it("a failing surface check throws RENDERER:CONFORMANCE_FAILED naming runSurfaceConformance", () => {
    const service = makeSurface((svc) => {
      svc.resize = () => {};
    });
    const error = thrownBy(() => runSurfaceConformance(service));
    expect(error.code).toBe(RendererErrorCodes.CONFORMANCE_FAILED);
    expect(error.composable).toBe("runSurfaceConformance");
    expect(error.message.startsWith("[runSurfaceConformance()] ")).toBe(true);
    expect(error.message).not.toContain("[runSurfaceConformance] ");
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

interface SurfaceRecord {
  mounts: number;
  unmounts: number;
  resizes: Array<[number, number, number]>;
  renders: number[];
  canvases: HTMLCanvasElement[];
}

interface SurfaceKnobs {
  /** The second `mount()` appends the canvas of the first one again. */
  reuseCanvas?: boolean;
  /** The second `mount()` throws. */
  failSecondMount?: boolean;
  /** `unmount()` throws when nothing is mounted. */
  strictUnmount?: boolean;
  /** `renderViews` appends the last canvas to `document.body`. */
  reattachOnRender?: boolean;
  /** `renderViews` throws this value. */
  throwOnRender?: unknown;
  /** `resize` writes the canvas at dpr 1. */
  ignoreDpr?: boolean;
  /** The unmount after the second `mount()` leaves that canvas in the container. */
  keepSecondCanvas?: boolean;
  /** The second `mount()` appends the first canvas again, after the new one. */
  reappendFirst?: boolean;
}

function surfaceRecord(): SurfaceRecord {
  return { mounts: 0, unmounts: 0, resizes: [], renders: [], canvases: [] };
}

function recordingSurface(rec: SurfaceRecord, knobs: SurfaceKnobs = {}): SurfaceRendererService {
  let current: HTMLCanvasElement | null = null;
  return {
    name: "renderer:reentrant",
    contractVersion: RENDERER_CONTRACT_VERSION,
    kind: "surface",
    layers: { scene: { order: 0, coordinate: "world" } },
    mount(container) {
      rec.mounts += 1;
      if (knobs.failSecondMount === true && rec.mounts === 2) throw new Error("already mounted");
      const first = rec.canvases[0];
      current =
        knobs.reuseCanvas === true && first !== undefined
          ? first
          : container.ownerDocument.createElement("canvas");
      rec.canvases.push(current);
      container.appendChild(current);
      if (
        knobs.reappendFirst === true &&
        rec.mounts === 2 &&
        first !== undefined &&
        first !== current
      ) {
        container.appendChild(first);
      }
    },
    unmount() {
      rec.unmounts += 1;
      if (knobs.strictUnmount === true && current === null) throw new Error("not mounted");
      if (knobs.keepSecondCanvas === true && rec.mounts === 2 && current !== null) {
        current = null;
        return;
      }
      current?.remove();
      current = null;
    },
    resize(width, height, dpr) {
      rec.resizes.push([width, height, dpr]);
      if (current === null) return;
      const ratio = knobs.ignoreDpr === true ? 1 : dpr;
      current.width = Math.round(width * ratio);
      current.height = Math.round(height * ratio);
    },
    getLayerElement() {
      if (current === null) throw new Error("canvas is created in mount()");
      return current;
    },
    renderViews(views) {
      rec.renders.push(views.length);
      if (knobs.throwOnRender !== undefined) throw knobs.throwOnRender;
      const last = rec.canvases[rec.canvases.length - 1];
      if (knobs.reattachOnRender === true && last !== undefined) document.body.appendChild(last);
    },
  };
}

describe("runSurfaceConformance re-entry, options and error text", () => {
  afterEach(() => {
    for (const canvas of document.querySelectorAll("canvas")) canvas.remove();
  });

  it("fails a surface that cannot mount again after unmount", () => {
    const rec = surfaceRecord();
    const error = thrownBy(() =>
      runSurfaceConformance(recordingSurface(rec, { failSecondMount: true })),
    );
    expect(error.code).toBe("RENDERER:CONFORMANCE_FAILED");
    expect(error.composable).toBe("runSurfaceConformance");
    expect(error.message).toContain("mount");
    expect(error.message).toContain("again");
    expect(error.cause).toBeInstanceOf(Error);
  });

  it("fails a surface whose second mount returns the canvas of the first one", () => {
    const error = thrownBy(() =>
      runSurfaceConformance(recordingSurface(surfaceRecord(), { reuseCanvas: true })),
    );
    expect(error.code).toBe("RENDERER:CONFORMANCE_FAILED");
    expect(error.message).toContain("new canvas");
  });

  it("passes a surface that builds a new canvas on every mount and mounts it twice", () => {
    const rec = surfaceRecord();
    expect(() => runSurfaceConformance(recordingSurface(rec))).not.toThrow();
    expect(rec.mounts).toBe(2);
    expect(rec.canvases).toHaveLength(2);
    expect(rec.canvases[0]).not.toBe(rec.canvases[1]);
    expect(rec.canvases.some((canvas) => canvas.isConnected)).toBe(false);
  });

  it("fails a surface whose unmount throws when it is called a second time", () => {
    const rec = surfaceRecord();
    const error = thrownBy(() =>
      runSurfaceConformance(recordingSurface(rec, { strictUnmount: true })),
    );
    expect(error.code).toBe("RENDERER:CONFORMANCE_FAILED");
    expect(error.message).toContain("unmount");
    expect(error.message).toContain("twice");
  });

  it("fails a surface whose renderViews after unmount connects a canvas", () => {
    const error = thrownBy(() =>
      runSurfaceConformance(recordingSurface(surfaceRecord(), { reattachOnRender: true })),
    );
    expect(error.code).toBe("RENDERER:CONFORMANCE_FAILED");
    expect(error.message).toContain("renderViews");
    expect(error.message).toContain("canvas");
  });

  it("names a thrown value that is not an Error without a bracket", () => {
    const error = thrownBy(() =>
      runSurfaceConformance(
        recordingSurface(surfaceRecord(), { throwOnRender: { reason: "no gpu" } }),
      ),
    );
    expect(error.code).toBe("RENDERER:CONFORMANCE_FAILED");
    expect(error.message).toContain("0 views");
    expect(error.message.slice("[runSurfaceConformance()] ".length)).not.toContain("[");
  });

  it("names an Error whose message holds a bracket without one", () => {
    const error = thrownBy(() =>
      runSurfaceConformance(
        recordingSurface(surfaceRecord(), { throwOnRender: new Error("[gpu] lost") }),
      ),
    );
    expect(error.code).toBe("RENDERER:CONFORMANCE_FAILED");
    expect(error.message).toContain("0 views");
    expect(error.message).toContain("(gpu) lost");
    expect(error.message.slice("[runSurfaceConformance()] ".length)).not.toContain("[");
  });

  it("unmounts a surface that ignores dpr after resize fails", () => {
    const rec = surfaceRecord();
    const error = thrownBy(() =>
      runSurfaceConformance(recordingSurface(rec, { ignoreDpr: true }), { dpr: 3 }),
    );
    expect(error.code).toBe("RENDERER:CONFORMANCE_FAILED");
    expect(rec.unmounts).toBe(1);
  });

  it("fails a surface whose second unmount leaves its canvas attached", () => {
    const error = thrownBy(() =>
      runSurfaceConformance(recordingSurface(surfaceRecord(), { keepSecondCanvas: true })),
    );
    expect(error.code).toBe("RENDERER:CONFORMANCE_FAILED");
    expect(error.message).toContain("second unmount");
  });

  it("fails a surface whose second mount reconnects the first canvas", () => {
    const error = thrownBy(() =>
      runSurfaceConformance(recordingSurface(surfaceRecord(), { reappendFirst: true })),
    );
    expect(error.code).toBe("RENDERER:CONFORMANCE_FAILED");
    expect(error.message).toContain("first canvas");
    expect(error.message).toContain("second mount");
  });

  it("sizes the canvas with the dpr of options", () => {
    const rec = surfaceRecord();
    runSurfaceConformance(recordingSurface(rec), { dpr: 3 });
    expect(rec.resizes).toEqual([
      [320, 180, 3],
      [320, 180, 3],
    ]);
  });

  it("uses a dpr of 2 when options holds none", () => {
    const rec = surfaceRecord();
    runSurfaceConformance(recordingSurface(rec));
    expect(rec.resizes.map((entry) => entry[2])).toEqual([2, 2]);
  });

  it("rejects a dpr that is not a positive finite number", () => {
    const messages: string[] = [];
    for (const dpr of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const rec = surfaceRecord();
      const error = thrownBy(() => runSurfaceConformance(recordingSurface(rec), { dpr }));
      expect(error.code).toBe("RENDERER:CONFORMANCE_FAILED");
      expect(rec.mounts).toBe(0);
      messages.push(error.message);
    }
    expect(messages.every((message) => message.includes("dpr"))).toBe(true);
  });

  it("needs no engine and no screenService", () => {
    const rec = surfaceRecord();
    expect(() => runSurfaceConformance(recordingSurface(rec))).not.toThrow();
    expect(rec.mounts).toBe(2);
  });
});

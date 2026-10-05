// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { runConformanceTests, runSurfaceConformance } from "../src/testing/index.js";
import type { RendererService, SurfaceRendererService } from "../src/types.js";
import { RENDERER_CONTRACT_VERSION } from "../src/types.js";
import { getOrCreateScreenService } from "../src/get-or-create-screen-service.js";
import { getOrCreateViewportManager } from "../src/get-or-create-viewport-manager.js";
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
    const svc = {
      ...makeCompliantService(),
      getLayerElement: vi.fn(() => {
        throw new Error("not found");
      }),
    };
    expect(() => runConformanceTests(svc)).toThrow();
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
    setSink: vi.fn(),
  };
  const logger: GwenLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnValue(childLogger),
    setSink: vi.fn(),
  };
  return {
    logger,
    provide: vi.fn((key: string, value: unknown) => {
      services.set(key, value);
    }),
    tryInject: vi.fn((key: string) => services.get(key)),
    hooks: { hook: vi.fn(), callHook: vi.fn() },
  } as unknown as GwenEngine;
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
    screenDpr = 2;
    const viewports = getOrCreateViewportManager(engine);
    viewports.set("main", { x: 0, y: 0, width: 1, height: 1 });
    getOrCreateScreenService(engine).setContainerSize(800, 600, screenDpr);

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

  it("fails when the canvas stays attached after unmount", () => {
    const engine = makeEngine();
    getOrCreateViewportManager(engine).set("main", { x: 0, y: 0, width: 1, height: 1 });
    getOrCreateScreenService(engine).setContainerSize(800, 600, 2);
    const service = makeSurface((svc) => {
      svc.unmount = () => {};
    });
    expect(() => runSurfaceConformance(service, engine)).toThrow(/unmount/);
  });

  it("fails when resize ignores dpr", () => {
    const engine = makeEngine();
    screenDpr = 2;
    getOrCreateViewportManager(engine).set("main", { x: 0, y: 0, width: 1, height: 1 });
    getOrCreateScreenService(engine).setContainerSize(800, 600, 2);
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
    getOrCreateViewportManager(engine).set("main", { x: 0, y: 0, width: 1, height: 1 });
    getOrCreateScreenService(engine).setContainerSize(800, 600, 2);
    const service = makeSurface((svc) => {
      svc.renderViews = (views) => {
        if (views.length === 2) throw new Error("nope");
      };
    });
    expect(() => runSurfaceConformance(service, engine)).toThrow(/2 views/);
  });

  it("fails when kind is not surface", () => {
    const engine = makeEngine();
    const service = makeSurface();
    (service as { kind: "layers" }).kind = "layers";
    expect(() => runSurfaceConformance(service, engine)).toThrow(/surface/);
  });
});

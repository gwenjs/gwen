// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createEngine } from "@gwenjs/core";
import type { LayerHost } from "@gwenjs/schema";
import { GwenError } from "@gwenjs/schema";
import { LayerManager } from "../src/layer-manager.js";
import { getOrCreateLayerManager } from "../src/get-or-create-layer-manager.js";
import { getOrCreateCameraManager } from "../src/get-or-create-camera-manager.js";
import { getOrCreateScreenService } from "../src/get-or-create-screen-service.js";
import { getOrCreateViewportManager } from "../src/get-or-create-viewport-manager.js";
import { writeCameraViews } from "../src/write-camera-views.js";
import type {
  LayerDef,
  RendererService,
  RenderView,
  SurfaceRendererService,
} from "../src/types.js";
import { RENDERER_CONTRACT_VERSION } from "../src/types.js";
import {
  EmptyLayersError,
  LayerOrderConflictError,
  RendererAlreadyRegisteredError,
  RendererContractVersionError,
  RendererErrorCodes,
  SurfaceInvalidError,
} from "../src/errors.js";
import { createRendererStats } from "../src/stats.js";
import type { RendererKind } from "../src/types.js";

function surfaceService(name: string, order: number, onRender: () => void): SurfaceRendererService {
  let canvas: HTMLCanvasElement | null = null;
  return {
    name,
    contractVersion: RENDERER_CONTRACT_VERSION,
    kind: "surface",
    layers: { scene: { order, coordinate: "world" } },
    mount(container) {
      canvas = document.createElement("canvas");
      container.appendChild(canvas);
    },
    unmount() {
      canvas?.remove();
      canvas = null;
    },
    resize() {},
    getLayerElement() {
      if (canvas === null) throw new Error("canvas is created in mount()");
      return canvas;
    },
    renderViews() {
      onRender();
    },
  };
}

/** Factory for a minimal valid RendererService mock. */
function makeService(
  name: string,
  layers: RendererService["layers"],
  contractVersion = RENDERER_CONTRACT_VERSION,
  kind?: RendererKind,
): RendererService {
  const elements: Record<string, HTMLElement> = {};
  return {
    name,
    contractVersion,
    ...(kind !== undefined ? { kind } : {}),
    layers,
    mount: vi.fn(),
    unmount: vi.fn(),
    resize: vi.fn(),
    getLayerElement: vi.fn((layerName: string) => {
      if (!elements[layerName]) {
        elements[layerName] = document.createElement("div");
      }
      return elements[layerName]!;
    }),
    setStatsCollector: vi.fn(),
  };
}

describe("LayerManager", () => {
  let manager: LayerManager;
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
    manager = new LayerManager(root);
  });

  afterEach(() => {
    root.remove();
  });

  // ── Registration ──────────────────────────────────────────────────────────

  it("registers a renderer without error", () => {
    const svc = makeService("renderer:canvas", { game: { order: 10 } });
    expect(() => manager.register(svc)).not.toThrow();
  });

  it("throws RendererAlreadyRegisteredError on duplicate name", () => {
    const svc1 = makeService("renderer:canvas", { game: { order: 10 } });
    const svc2 = makeService("renderer:canvas", { other: { order: 20 } });
    manager.register(svc1);
    expect(() => manager.register(svc2)).toThrowError(RendererAlreadyRegisteredError);
  });

  it("throws RendererContractVersionError on version mismatch", () => {
    const svc = makeService("renderer:canvas", { game: { order: 10 } }, 999);
    expect(() => manager.register(svc)).toThrowError(RendererContractVersionError);
  });

  it("throws EmptyLayersError when registering a renderer with zero layers", () => {
    const svc = makeService("renderer:canvas", {});
    expect(() => manager.register(svc)).toThrowError(EmptyLayersError);
  });

  it("throws RendererContractVersionError when contractVersion is 1", () => {
    const svc = makeService("renderer:canvas", { game: { order: 10 } }, 1);
    expect(() => manager.register(svc)).toThrowError(RendererContractVersionError);
    try {
      manager.register(svc);
    } catch (err) {
      expect(err).toMatchObject({ code: "RENDERER:CONTRACT_VERSION" });
    }
  });

  it("throws SurfaceInvalidError when a surface renderer declares two layers", () => {
    const svc = makeService(
      "renderer:surface",
      {
        scene: { order: 0, coordinate: "world" },
        extra: { order: 1, coordinate: "world" },
      },
      RENDERER_CONTRACT_VERSION,
      "surface",
    );
    expect(() => manager.register(svc)).toThrowError(SurfaceInvalidError);
    try {
      manager.register(svc);
    } catch (err) {
      expect(err).toMatchObject({ code: "RENDERER:SURFACE_INVALID" });
    }
  });

  it("throws SurfaceInvalidError when the only surface layer is not world", () => {
    const svc = makeService(
      "renderer:surface",
      { scene: { order: 0, coordinate: "screen" } },
      RENDERER_CONTRACT_VERSION,
      "surface",
    );
    expect(() => manager.register(svc)).toThrowError(SurfaceInvalidError);
  });

  // ── DOM mounting ─────────────────────────────────────────────────────────

  it("calls mount() on each registered renderer after mount()", () => {
    const svc = makeService("renderer:canvas", { game: { order: 10 } });
    manager.register(svc);
    manager.mount();
    expect(svc.mount).toHaveBeenCalledOnce();
  });

  it("inserts layer elements into the root container", () => {
    const svc = makeService("renderer:canvas", { game: { order: 10 } });
    manager.register(svc);
    manager.mount();
    expect(root.children.length).toBeGreaterThan(0);
  });

  it("sorts layers by order ascending in the DOM", () => {
    const html = makeService("renderer:html", { hud: { order: 100 }, bg: { order: 0 } });
    const canvas = makeService("renderer:canvas", { game: { order: 10 } });
    manager.register(html);
    manager.register(canvas);
    manager.mount();

    const zIndexes = Array.from(root.children).map((el) =>
      parseInt((el as HTMLElement).style.zIndex, 10),
    );
    for (let i = 1; i < zIndexes.length; i++) {
      expect(zIndexes[i]).toBeGreaterThanOrEqual(zIndexes[i - 1]!);
    }
  });

  // ── Resize ────────────────────────────────────────────────────────────────

  it("propagates resize() to all registered renderers", () => {
    const svc1 = makeService("renderer:canvas", { game: { order: 10 } });
    const svc2 = makeService("renderer:html", { hud: { order: 100 } });
    manager.register(svc1);
    manager.register(svc2);
    manager.resize(1280, 720, 1);
    expect(svc1.resize).toHaveBeenCalledWith(1280, 720, 1);
    expect(svc2.resize).toHaveBeenCalledWith(1280, 720, 1);
  });

  // ── Unregister ────────────────────────────────────────────────────────────

  it("removes renderer and cleans up DOM on unregister()", () => {
    const svc = makeService("renderer:canvas", { game: { order: 10 } });
    manager.register(svc);
    manager.mount();
    const childCountBefore = root.children.length;
    manager.unregister("renderer:canvas");
    expect(svc.unmount).toHaveBeenCalledOnce();
    expect(root.children.length).toBeLessThan(childCountBefore);
  });

  it("is a no-op when unregistering an unknown renderer name", () => {
    expect(() => manager.unregister("renderer:unknown")).not.toThrow();
  });

  // ── Layer order conflict ──────────────────────────────────────────────────

  it("does not throw on layer order conflict — only warns", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const svc1 = makeService("renderer:canvas", { game: { order: 10 } });
    const svc2 = makeService("renderer:html", { overlay: { order: 10 } });
    manager.register(svc1);
    expect(() => manager.register(svc2)).not.toThrow();
    warnSpy.mockRestore();
  });

  it("emits a warning message containing the conflicting layer names on order conflict", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const svc1 = makeService("renderer:canvas", { game: { order: 10 } });
    const svc2 = makeService("renderer:html", { overlay: { order: 10 } });
    manager.register(svc1);
    manager.register(svc2);
    expect(warnSpy).toHaveBeenCalledWith(
      "[renderer-core:layer-manager]",
      expect.stringContaining("RENDERER:LAYER_ORDER_CONFLICT"),
    );
    warnSpy.mockRestore();
  });

  it("warns when a single renderer declares two layers with the same order", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const svc = makeService("renderer:canvas", { bg: { order: 10 }, fg: { order: 10 } });
    manager.register(svc);
    expect(warnSpy).toHaveBeenCalledWith(
      "[renderer-core:layer-manager]",
      expect.stringContaining("RENDERER:LAYER_ORDER_CONFLICT"),
    );
    warnSpy.mockRestore();
  });

  it("throws LAYER_ORDER_CONFLICT when a HUD uses the surface order", () => {
    const surface = makeService(
      "renderer:surface",
      { scene: { order: 10, coordinate: "world" } },
      RENDERER_CONTRACT_VERSION,
      "surface",
    );
    const hud = makeService("renderer:html", { hud: { order: 10, coordinate: "screen" } });
    manager.register(surface);
    expect(() => manager.register(hud)).toThrowError(LayerOrderConflictError);
    try {
      manager.register(hud);
    } catch (err) {
      expect(err).toMatchObject({ code: "RENDERER:LAYER_ORDER_CONFLICT" });
    }
  });

  it("throws LAYER_ORDER_CONFLICT when the surface is registered second at the same order", () => {
    const hud = makeService("renderer:html", { hud: { order: 0, coordinate: "screen" } });
    const surface = makeService(
      "renderer:surface",
      { scene: { order: 0, coordinate: "world" } },
      RENDERER_CONTRACT_VERSION,
      "surface",
    );
    manager.register(hud);
    expect(() => manager.register(surface)).toThrowError(LayerOrderConflictError);
  });

  it("mounts a surface under a screen HUD with a greater order", () => {
    const surface = makeService(
      "renderer:surface",
      { scene: { order: 0, coordinate: "world" } },
      RENDERER_CONTRACT_VERSION,
      "surface",
    );
    const hud = makeService("renderer:html", {
      hud: { order: 10, coordinate: "screen", scope: "global" },
    });
    manager.register(surface);
    manager.register(hud);
    manager.mount();

    const scene = root.querySelector("[data-gwen-layer='renderer:surface:scene']") as HTMLElement;
    const hudEl = root.querySelector("[data-gwen-layer='renderer:html:hud']") as HTMLElement;
    expect(scene.style.zIndex).toBe("0");
    expect(scene.style.pointerEvents).not.toBe("none");
    expect(hudEl.style.zIndex).toBe("10");
    expect(hudEl.style.pointerEvents).toBe("none");
  });

  it("reads a surface canvas after mount and removes it on unregister", () => {
    let canvas: HTMLCanvasElement | null = null;
    let mounted = false;
    const service: SurfaceRendererService = {
      name: "renderer:surface",
      contractVersion: RENDERER_CONTRACT_VERSION,
      kind: "surface",
      layers: { scene: { order: 0, coordinate: "world" } },
      mount() {
        mounted = true;
        canvas = document.createElement("canvas");
      },
      unmount() {
        canvas?.remove();
        canvas = null;
        mounted = false;
      },
      resize() {},
      getLayerElement() {
        if (!mounted || canvas === null) throw new Error("canvas is created in mount()");
        return canvas;
      },
      renderViews() {},
    };
    manager.register(service);
    expect(() => manager.mount()).not.toThrow();
    const scene = root.querySelector("[data-gwen-layer='renderer:surface:scene']");
    expect(scene).toBeInstanceOf(HTMLCanvasElement);
    expect(scene).toBe(canvas);
    manager.unregister("renderer:surface");
    expect(canvas).toBeNull();
    expect(root.querySelector("[data-gwen-layer='renderer:surface:scene']")).toBeNull();
  });

  it("calls renderViews once per engine:render with writeCameraViews output", async () => {
    const engine = await createEngine({ maxEntities: 32 });
    try {
      getOrCreateViewportManager(engine).set("main", { x: 0, y: 0, width: 1, height: 1 });
      getOrCreateScreenService(engine).setContainerSize(200, 100, 1);
      getOrCreateCameraManager(engine).set("main", {
        worldTransform: {
          position: { x: 4, y: 5, z: 6 },
          rotation: { x: 0, y: 0, z: 0 },
        },
        projection: { type: "perspective", fov: Math.PI / 2, near: 1, far: 3 },
        viewportId: "main",
        active: true,
        priority: 0,
      });

      const calls: Array<{ alpha: number; views: RenderView[] }> = [];
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
        resize() {},
        getLayerElement() {
          if (canvas === null) throw new Error("canvas is created in mount()");
          return canvas;
        },
        renderViews(views, alpha) {
          calls.push({
            alpha,
            views: views.map((view) => ({
              viewportId: view.viewportId,
              eye: view.eye,
              viewMatrix: new Float32Array(view.viewMatrix),
              projectionMatrix: new Float32Array(view.projectionMatrix),
              pixelRect: { ...view.pixelRect },
            })),
          });
        },
      };

      const wired = getOrCreateLayerManager(engine, root);
      wired.register(service);
      wired.mount();
      await engine.hooks.callHook("engine:render", 1);
      expect(calls).toHaveLength(1);
      const first = calls[0];
      expect(first?.alpha).toBe(1);
      expect(first?.views).toHaveLength(1);

      const expected: RenderView = {
        viewportId: "",
        eye: "none",
        viewMatrix: new Float32Array(16),
        projectionMatrix: new Float32Array(16),
        pixelRect: { x: 0, y: 0, width: 0, height: 0 },
      };
      expect(writeCameraViews(engine, [expected])).toBe(1);
      const seen = first?.views[0];
      expect(seen?.viewportId).toBe(expected.viewportId);
      expect(seen?.eye).toBe(expected.eye);
      expect(Array.from(seen?.viewMatrix ?? [])).toEqual(Array.from(expected.viewMatrix));
      expect(Array.from(seen?.projectionMatrix ?? [])).toEqual(
        Array.from(expected.projectionMatrix),
      );

      await engine.hooks.callHook("engine:render", 1);
      expect(calls).toHaveLength(2);
    } finally {
      await engine.stop();
    }
  });

  it("does not call renderViews for a surface registered after mount", async () => {
    const engine = await createEngine({ maxEntities: 32 });
    try {
      const calls = { early: 0, late: 0 };
      const early = surfaceService("renderer:early", 0, () => {
        calls.early += 1;
      });
      const late = surfaceService("renderer:late", 1, () => {
        calls.late += 1;
      });
      const wired = getOrCreateLayerManager(engine, root);
      wired.register(early);
      wired.mount();
      await engine.hooks.callHook("engine:render", 1);
      expect(calls.early).toBe(1);
      wired.register(late);
      await engine.hooks.callHook("engine:render", 1);
      expect(calls.early).toBe(2);
      expect(calls.late).toBe(0);
      wired.mount();
      await engine.hooks.callHook("engine:render", 1);
      expect(calls.late).toBe(1);
    } finally {
      await engine.stop();
    }
  });

  it("dispose drops the engine:render hook", async () => {
    const engine = await createEngine({ maxEntities: 32 });
    try {
      let calls = 0;
      const service = surfaceService("renderer:surface", 0, () => {
        calls += 1;
      });
      const wired = getOrCreateLayerManager(engine, root);
      wired.register(service);
      wired.mount();
      await engine.hooks.callHook("engine:render", 1);
      expect(calls).toBe(1);
      wired.dispose();
      await engine.hooks.callHook("engine:render", 1);
      expect(calls).toBe(1);
    } finally {
      await engine.stop();
    }
  });

  it("warns only once for a duplicate order within a single renderer", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const svc = makeService("renderer:canvas", {
      a: { order: 5 },
      b: { order: 5 },
      c: { order: 5 },
    });
    manager.register(svc);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  // ── Stats ─────────────────────────────────────────────────────────────────

  it("calls setStatsCollector() after mount() when stats are enabled", () => {
    const svc = makeService("renderer:canvas", { game: { order: 10 } });
    manager.register(svc);
    manager.enableStats();
    manager.mount();
    expect(svc.setStatsCollector).toHaveBeenCalledOnce();
  });

  it("getStats() returns a RendererStats object", () => {
    const stats = manager.getStats();
    expect(stats).toHaveProperty("renderers");
    expect(stats).toHaveProperty("history");
  });

  it("enables stats for renderers registered after enableStats()", () => {
    manager.enableStats();
    const svc = makeService("renderer:canvas", { game: { order: 10 } });
    manager.register(svc);
    manager.mount();
    // setStatsCollector must be called even when enableStats() preceded register()
    expect(svc.setStatsCollector).toHaveBeenCalledOnce();
  });

  it("mount() is idempotent — calling it twice does not double-insert elements", () => {
    const svc = makeService("renderer:canvas", { game: { order: 10 } });
    manager.register(svc);
    manager.mount();
    const countAfterFirst = root.children.length;
    manager.mount();
    expect(root.children.length).toBe(countAfterFirst);
  });

  // ── beginFrame ────────────────────────────────────────────────────────────

  it("beginFrame() is a no-op when stats are disabled", () => {
    const svc = makeService("renderer:canvas", { game: { order: 10 } });
    manager.register(svc);
    // No enableStats() — beginFrame must not throw
    expect(() => manager.beginFrame()).not.toThrow();
  });

  it("beginFrame() resets global totals to zero each frame", () => {
    const svc = makeService("renderer:canvas", { game: { order: 10 } });
    manager.register(svc);
    manager.enableStats();
    manager.mount();

    // Simulate a frame: stats collector receives reports
    const stats = manager.getStats();
    // Manually bump totals (simulating what reportLayer/reportFrameTime would do)
    stats.totalRenderTimeMs = 5;
    stats.totalDrawCalls = 10;
    stats.totalEntitiesRendered = 20;

    manager.beginFrame();

    expect(stats.totalRenderTimeMs).toBe(0);
    expect(stats.totalDrawCalls).toBe(0);
    expect(stats.totalEntitiesRendered).toBe(0);
  });

  it("beginFrame() resets per-renderer frameTimeMs", () => {
    const svc = makeService("renderer:canvas", { game: { order: 10 } });
    manager.register(svc);
    manager.enableStats();
    manager.mount();

    // Inject a real collector via setStatsCollector so we can test the reset path
    const stats = manager.getStats();
    stats.renderers["renderer:canvas"] = {
      type: "canvas",
      frameTimeMs: 8,
      layers: {
        game: {
          order: 10,
          coordinate: "screen",
          entityCount: 3,
          drawCalls: 2,
          domNodes: 0,
          visible: true,
          frameTimeMs: 4,
        },
      },
    };

    manager.beginFrame();

    expect(stats.renderers["renderer:canvas"]?.frameTimeMs).toBe(0);
    expect(stats.renderers["renderer:canvas"]?.layers["game"]?.drawCalls).toBe(0);
  });
});

interface SeenResize {
  width: number;
  height: number;
  dpr: number | undefined;
}

/** Real RendererService. Stores the resize arguments. Does not use a mock. */
function liveService(
  name: string,
  layers: RendererService["layers"],
): RendererService & { readonly seen: SeenResize | undefined } {
  const elements = new Map<string, HTMLElement>();
  let seen: SeenResize | undefined;
  return {
    name,
    contractVersion: RENDERER_CONTRACT_VERSION,
    layers,
    get seen() {
      return seen;
    },
    mount(_container: HTMLElement): void {},
    unmount(): void {},
    resize(width: number, height: number, dpr?: number): void {
      seen = { width, height, dpr };
    },
    getLayerElement(layerName: string): HTMLElement {
      const existing = elements.get(layerName);
      if (existing !== undefined) return existing;
      const created = document.createElement("div");
      elements.set(layerName, created);
      return created;
    },
  };
}

function mountRoot(): HTMLElement {
  const root = document.createElement("div");
  document.body.appendChild(root);
  return root;
}

describe("LayerManager host contract", () => {
  it("has() is true for a registered renderer, false for an unknown name and after unregister, per manager instance", () => {
    const rootA = mountRoot();
    const rootB = mountRoot();
    const managerA = new LayerManager(rootA);
    const managerB = new LayerManager(rootB);
    try {
      const service = liveService("renderer:a", { game: { order: 1 } });
      managerA.register(service);
      expect(managerA.has("renderer:missing")).toBe(false);
      expect(managerB.has("renderer:a")).toBe(false);
      expect(managerA.has("renderer:a")).toBe(true);
      managerA.unregister("renderer:a");
      expect(managerA.has("renderer:a")).toBe(false);
      expect(managerB.has("renderer:a")).toBe(false);
    } finally {
      rootA.remove();
      rootB.remove();
    }
  });

  it("setParallax copies x and y onto every registered layer of that name and throws for an unknown name", () => {
    const rootA = mountRoot();
    const rootB = mountRoot();
    const managerA = new LayerManager(rootA);
    const managerB = new LayerManager(rootB);
    try {
      const gameA: LayerDef = { order: 1 };
      const gameC: LayerDef = { order: 3 };
      const gameB: LayerDef = { order: 1 };
      managerA.register(liveService("renderer:a", { game: gameA }));
      managerA.register(liveService("renderer:c", { game: gameC }));
      managerB.register(liveService("renderer:b", { game: gameB }));
      managerA.setParallax?.("game", { x: 0.5, y: 0.25 });
      expect(gameA.parallax).toEqual({ x: 0.5, y: 0.25 });
      expect(gameC.parallax).toEqual({ x: 0.5, y: 0.25 });
      expect(gameB.parallax).toBeUndefined();
      managerA.setParallax("game", { x: 2, y: 3 });
      expect(gameA.parallax).toEqual({ x: 2, y: 3 });
      expect(gameC.parallax).toEqual({ x: 2, y: 3 });
      let caught: unknown;
      try {
        managerA.setParallax("nope", { x: 1, y: 1 });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(GwenError);
      if (!(caught instanceof GwenError)) return;
      const hint = "Registered renderers: renderer:a, renderer:c.";
      expect(caught.hint).toBe(__GWEN_DEV__ ? hint : undefined);
      expect(caught.code).toBe("RENDERER:UNKNOWN_LAYER");
      expect(caught.message).toBe(
        [
          '[setParallax()] No registered renderer declares layer "nope".',
          ...(__GWEN_DEV__ ? [`Fix: ${hint}`] : []),
          "See https://gwenjs.github.io/gwen/api/errors#renderer-unknown-layer (RENDERER:UNKNOWN_LAYER)",
        ].join("\n"),
      );
    } finally {
      rootA.remove();
      rootB.remove();
    }
  });

  it("resize forwards (width, height, dpr) to every renderer", () => {
    const root = mountRoot();
    const manager = new LayerManager(root);
    try {
      const first = liveService("renderer:a", { game: { order: 1 } });
      const second = liveService("renderer:b", { hud: { order: 2 } });
      manager.register(first);
      manager.register(second);
      manager.resize(800, 600, 2);
      expect(first.seen).toEqual({ width: 800, height: 600, dpr: 2 });
      expect(second.seen).toEqual({ width: 800, height: 600, dpr: 2 });
    } finally {
      root.remove();
    }
  });

  it("resize forwards 1 when dpr is omitted", () => {
    const root = mountRoot();
    const manager = new LayerManager(root);
    try {
      const service = liveService("renderer:a", { game: { order: 1 } });
      manager.register(service);
      manager.resize(800, 600);
      expect(service.seen).toEqual({ width: 800, height: 600, dpr: 1 });
    } finally {
      root.remove();
    }
  });

  it("setParallax copies the factor onto a LayerDef shared by two managers", () => {
    const rootA = mountRoot();
    const rootB = mountRoot();
    const managerA = new LayerManager(rootA);
    const managerB = new LayerManager(rootB);
    try {
      const shared: LayerDef = { order: 1 };
      managerA.register(liveService("renderer:a", { game: shared }));
      managerB.register(liveService("renderer:b", { game: shared }));
      managerA.setParallax("game", { x: 0.5, y: 0.25 });
      expect(shared.parallax).toEqual({ x: 0.5, y: 0.25 });
    } finally {
      rootA.remove();
      rootB.remove();
    }
  });

  it("setParallax names no renderer when none are registered", () => {
    const root = mountRoot();
    const manager = new LayerManager(root);
    try {
      let caught: unknown;
      try {
        manager.setParallax("nope", { x: 1, y: 1 });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(GwenError);
      if (!(caught instanceof GwenError)) return;
      const hint = "Registered renderers: none.";
      expect(caught.hint).toBe(__GWEN_DEV__ ? hint : undefined);
      expect(caught.code).toBe("RENDERER:UNKNOWN_LAYER");
      expect(caught.message).toBe(
        [
          '[setParallax()] No registered renderer declares layer "nope".',
          ...(__GWEN_DEV__ ? [`Fix: ${hint}`] : []),
          "See https://gwenjs.github.io/gwen/api/errors#renderer-unknown-layer (RENDERER:UNKNOWN_LAYER)",
        ].join("\n"),
      );
    } finally {
      root.remove();
    }
  });
});

describe("getOrCreateLayerManager layerManager guard", () => {
  it("throws when the provided layerManager is not a LayerManager and keeps that value", async () => {
    const engine = await createEngine({ maxEntities: 32 });
    const root = mountRoot();
    try {
      const other = mountRoot();
      try {
        const first = getOrCreateLayerManager(engine, root);
        const second = getOrCreateLayerManager(engine, other);
        expect(second).toBe(first);
      } finally {
        other.remove();
      }

      const engineB = await createEngine({ maxEntities: 32 });
      const rootB = mountRoot();
      try {
        const onB = getOrCreateLayerManager(engineB, rootB);
        const onA = getOrCreateLayerManager(engine, root);
        expect(onB).not.toBe(onA);
      } finally {
        rootB.remove();
        await engineB.stop();
      }

      const host: LayerHost = {
        register() {},
        unregister() {},
        has() {
          return false;
        },
        getStats: () => createRendererStats(),
        setParallax() {},
      };
      engine.provide("layerManager", host);
      let caught: unknown;
      try {
        getOrCreateLayerManager(engine, root);
      } catch (error) {
        caught = error;
      }
      const hint =
        "Call getOrCreateLayerManager before providing layerManager, or provide the LayerManager this package created.";
      expect(caught).toBeInstanceOf(GwenError);
      if (!(caught instanceof GwenError)) return;
      expect(caught.hint).toBe(__GWEN_DEV__ ? hint : undefined);
      expect(caught.code).toBe(RendererErrorCodes.FOREIGN_LAYER_MANAGER);
      expect(caught.message).toBe(
        [
          "[getOrCreateLayerManager()] The provided layerManager is not a LayerManager from this package.",
          ...(__GWEN_DEV__ ? [`Fix: ${hint}`] : []),
          "See https://gwenjs.github.io/gwen/api/errors#renderer-foreign-layer-manager (RENDERER:FOREIGN_LAYER_MANAGER)",
        ].join("\n"),
      );
      expect(engine.tryInject("layerManager")).toBe(host);
    } finally {
      root.remove();
      await engine.stop();
    }
  });
});

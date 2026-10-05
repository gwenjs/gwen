// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createEngine } from "@gwenjs/core";
import { LayerManager } from "../src/layer-manager.js";
import { getOrCreateLayerManager } from "../src/get-or-create-layer-manager.js";
import { getOrCreateCameraManager } from "../src/get-or-create-camera-manager.js";
import { getOrCreateScreenService } from "../src/get-or-create-screen-service.js";
import { getOrCreateViewportManager } from "../src/get-or-create-viewport-manager.js";
import { writeCameraViews } from "../src/write-camera-views.js";
import type { RendererService, RenderView, SurfaceRendererService } from "../src/types.js";
import { RENDERER_CONTRACT_VERSION } from "../src/types.js";
import {
  EmptyLayersError,
  LayerOrderConflictError,
  RendererAlreadyRegisteredError,
  RendererContractVersionError,
  SurfaceInvalidError,
} from "../src/errors.js";
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
    manager.resize(1280, 720);
    expect(svc1.resize).toHaveBeenCalledWith(1280, 720);
    expect(svc2.resize).toHaveBeenCalledWith(1280, 720);
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
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("RENDERER:LAYER_ORDER_CONFLICT"));
    warnSpy.mockRestore();
  });

  it("warns when a single renderer declares two layers with the same order", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const svc = makeService("renderer:canvas", { bg: { order: 10 }, fg: { order: 10 } });
    manager.register(svc);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("RENDERER:LAYER_ORDER_CONFLICT"));
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
      await engine.hooks.callHook("engine:render");
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

      await engine.hooks.callHook("engine:render");
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
      await engine.hooks.callHook("engine:render");
      expect(calls.early).toBe(1);
      wired.register(late);
      await engine.hooks.callHook("engine:render");
      expect(calls.early).toBe(2);
      expect(calls.late).toBe(0);
      wired.mount();
      await engine.hooks.callHook("engine:render");
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
      await engine.hooks.callHook("engine:render");
      expect(calls).toBe(1);
      wired.dispose();
      await engine.hooks.callHook("engine:render");
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

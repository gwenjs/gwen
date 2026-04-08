// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { LayerManager } from "../src/layer-manager.js";
import type { RendererService } from "../src/types.js";
import { RENDERER_CONTRACT_VERSION } from "../src/types.js";
import {
  EmptyLayersError,
  RendererAlreadyRegisteredError,
  RendererContractVersionError,
} from "../src/errors.js";

/** Factory for a minimal valid RendererService mock. */
function makeService(
  name: string,
  layers: RendererService["layers"],
  contractVersion = RENDERER_CONTRACT_VERSION,
): RendererService {
  const elements: Record<string, HTMLElement> = {};
  return {
    name,
    contractVersion,
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

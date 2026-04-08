// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { defineRendererService } from "../src/define-renderer-service.js";
import { RENDERER_CONTRACT_VERSION } from "../src/types.js";
import { UnknownLayerError } from "../src/errors.js";
import type { RendererStatsCollector } from "../src/stats.js";

function makeCollector(): RendererStatsCollector {
  return {
    reportFrameTime: vi.fn(),
    reportLayer: vi.fn(),
  };
}

const SimpleRenderer = defineRendererService<{ layers: Record<string, { order: number }> }>(
  (opts) => ({
    name: "renderer:test",
    layers: opts.layers,
    createElement: vi.fn(() => document.createElement("canvas")),
    mount: vi.fn(),
    unmount: vi.fn(),
    resize: vi.fn(),
    flush: vi.fn(),
  }),
);

describe("defineRendererService", () => {
  let service: ReturnType<typeof SimpleRenderer>;

  beforeEach(() => {
    service = SimpleRenderer({ layers: { game: { order: 10 } } });
  });

  // ── Contract ──────────────────────────────────────────────────────────────

  it("injects RENDERER_CONTRACT_VERSION automatically", () => {
    expect(service.contractVersion).toBe(RENDERER_CONTRACT_VERSION);
  });

  it("preserves name and layers from the definition", () => {
    expect(service.name).toBe("renderer:test");
    expect(service.layers).toHaveProperty("game");
  });

  // ── Element caching ───────────────────────────────────────────────────────

  it("returns an HTMLElement for a declared layer", () => {
    const el = service.getLayerElement("game");
    expect(el).toBeInstanceOf(HTMLElement);
  });

  it("returns the same element instance on repeated calls (cache)", () => {
    const first = service.getLayerElement("game");
    const second = service.getLayerElement("game");
    expect(first).toBe(second);
  });

  it("calls createElement only once per layer", () => {
    const def = (service as unknown as { _def?: { createElement: ReturnType<typeof vi.fn> } })._def;
    // createElement is internal — verify via call count by making a new service
    let callCount = 0;
    const tracked = defineRendererService<object>(() => ({
      name: "renderer:tracked",
      layers: { bg: { order: 0 } },
      createElement() {
        callCount++;
        return document.createElement("div");
      },
      mount: vi.fn(),
      unmount: vi.fn(),
      resize: vi.fn(),
    }))({});
    tracked.getLayerElement("bg");
    tracked.getLayerElement("bg");
    tracked.getLayerElement("bg");
    expect(callCount).toBe(1);
    void def;
  });

  it("throws UnknownLayerError for an undeclared layer", () => {
    expect(() => service.getLayerElement("unknown")).toThrowError(UnknownLayerError);
  });

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  it("calls the mount callback when mounted", () => {
    const mountFn = vi.fn();
    const s = defineRendererService<object>(() => ({
      name: "renderer:mount-test",
      layers: { a: { order: 0 } },
      createElement: () => document.createElement("div"),
      mount: mountFn,
      unmount: vi.fn(),
      resize: vi.fn(),
    }))({});
    s.getLayerElement("a"); // prime cache
    s.mount(document.createElement("div"));
    expect(mountFn).toHaveBeenCalledOnce();
  });

  it("calls the unmount callback and clears element cache", () => {
    const unmountFn = vi.fn();
    let createCount = 0;
    const s = defineRendererService<object>(() => ({
      name: "renderer:unmount-test",
      layers: { a: { order: 0 } },
      createElement() {
        createCount++;
        return document.createElement("div");
      },
      mount: vi.fn(),
      unmount: unmountFn,
      resize: vi.fn(),
    }))({});
    s.getLayerElement("a");
    s.unmount();
    expect(unmountFn).toHaveBeenCalledOnce();
    // cache cleared — createElement called again
    s.getLayerElement("a");
    expect(createCount).toBe(2);
  });

  it("forwards resize to the definition", () => {
    const resizeFn = vi.fn();
    const s = defineRendererService<object>(() => ({
      name: "renderer:resize-test",
      layers: { a: { order: 0 } },
      createElement: () => document.createElement("div"),
      mount: vi.fn(),
      unmount: vi.fn(),
      resize: resizeFn,
    }))({});
    s.resize(1280, 720);
    expect(resizeFn).toHaveBeenCalledWith(1280, 720);
  });

  // ── Stats ─────────────────────────────────────────────────────────────────

  it("flush() is a no-op when no stats collector is set", () => {
    expect(() => service.flush()).not.toThrow();
  });

  it("flush() calls reportFrameTime on the collector when set", () => {
    const collector = makeCollector();
    service.setStatsCollector!(collector);

    const flushFn = vi.fn(({ reportFrameTime }: { reportFrameTime: (ms: number) => void }) => {
      reportFrameTime(16);
    });
    const s = defineRendererService<object>(() => ({
      name: "renderer:stats-test",
      layers: { a: { order: 0 } },
      createElement: () => document.createElement("div"),
      mount: vi.fn(),
      unmount: vi.fn(),
      resize: vi.fn(),
      flush: flushFn,
    }))({});
    s.setStatsCollector!(collector);
    s.flush();
    expect(collector.reportFrameTime).toHaveBeenCalledWith(16);
  });

  it("flush() reportFrameTime is a no-op without a collector", () => {
    const flushFn = vi.fn(({ reportFrameTime }: { reportFrameTime: (ms: number) => void }) => {
      reportFrameTime(16);
    });
    const s = defineRendererService<object>(() => ({
      name: "renderer:noop-test",
      layers: { a: { order: 0 } },
      createElement: () => document.createElement("div"),
      mount: vi.fn(),
      unmount: vi.fn(),
      resize: vi.fn(),
      flush: flushFn,
    }))({});
    expect(() => s.flush()).not.toThrow();
  });

  it("unmount() clears the stats collector", () => {
    const collector = makeCollector();
    service.setStatsCollector!(collector);
    service.unmount();
    // collector should no longer receive calls after unmount
    service.flush();
    expect(collector.reportFrameTime).not.toHaveBeenCalled();
  });

  // ── Multiple instances ────────────────────────────────────────────────────

  it("each factory call produces an independent instance", () => {
    const a = SimpleRenderer({ layers: { game: { order: 10 } } });
    const b = SimpleRenderer({ layers: { game: { order: 10 } } });
    expect(a.getLayerElement("game")).not.toBe(b.getLayerElement("game"));
  });
});

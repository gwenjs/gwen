import { describe, it, expect, beforeEach } from "vitest";
import { RendererStatsCollectorImpl, createRendererStats } from "../src/stats.js";

describe("createRendererStats", () => {
  it("returns a stats object with empty renderers map", () => {
    const stats = createRendererStats();
    expect(stats.renderers).toEqual({});
    expect(stats.totalRenderTimeMs).toBe(0);
    expect(stats.totalDrawCalls).toBe(0);
    expect(stats.totalEntitiesRendered).toBe(0);
  });

  it("initialises history ring buffers with 60 slots", () => {
    const stats = createRendererStats();
    expect(stats.history.frameTimeMs).toHaveLength(60);
    expect(stats.history.drawCalls).toHaveLength(60);
    expect(stats.history.head).toBe(0);
  });

  it("initialises history ring buffers to zero", () => {
    const stats = createRendererStats();
    expect(Array.from(stats.history.frameTimeMs).every((v) => v === 0)).toBe(true);
    expect(Array.from(stats.history.drawCalls).every((v) => v === 0)).toBe(true);
  });
});

describe("RendererStatsCollectorImpl", () => {
  let stats: ReturnType<typeof createRendererStats>;
  let collector: RendererStatsCollectorImpl;

  beforeEach(() => {
    stats = createRendererStats();
    collector = new RendererStatsCollectorImpl("renderer:canvas", stats);
  });

  it("is disabled by default (no-op calls)", () => {
    collector.reportLayer("game", { drawCalls: 5, entityCount: 10 });
    collector.reportFrameTime(12);
    expect(stats.renderers["renderer:canvas"]).toBeUndefined();
  });

  it("accumulates layer stats when enabled", () => {
    collector.enable();
    collector.reportLayer("game", { drawCalls: 5, entityCount: 10, frameTimeMs: 2 });
    expect(stats.renderers["renderer:canvas"]?.layers["game"]?.drawCalls).toBe(5);
    expect(stats.renderers["renderer:canvas"]?.layers["game"]?.entityCount).toBe(10);
  });

  it("accumulates frame time when enabled", () => {
    collector.enable();
    collector.reportFrameTime(8.5);
    expect(stats.renderers["renderer:canvas"]?.frameTimeMs).toBeCloseTo(8.5);
  });

  it("advances the ring buffer head on each frame time report", () => {
    collector.enable();
    collector.reportFrameTime(5);
    expect(stats.history.head).toBe(1);
    collector.reportFrameTime(7);
    expect(stats.history.head).toBe(2);
  });

  it("wraps the ring buffer head at 60", () => {
    collector.enable();
    for (let i = 0; i < 60; i++) collector.reportFrameTime(1);
    expect(stats.history.head).toBe(0);
    collector.reportFrameTime(2);
    expect(stats.history.head).toBe(1);
  });

  it("resets only per-renderer data on beginFrame(), not global totals", () => {
    collector.enable();
    collector.reportLayer("game", { drawCalls: 5 });
    collector.reportFrameTime(8);
    // global totals remain — only the renderer-specific stats are cleared
    const prevTotal = stats.totalDrawCalls;
    collector.beginFrame();
    expect(stats.totalDrawCalls).toBe(prevTotal); // global total NOT reset
    // per-renderer frame time IS reset
    expect(stats.renderers["renderer:canvas"]?.frameTimeMs).toBe(0);
  });

  it("does not wipe first renderer totals when second renderer calls beginFrame()", () => {
    const collector2 = new RendererStatsCollectorImpl("renderer:html", stats);
    collector.enable();
    collector2.enable();

    collector.reportLayer("game", { drawCalls: 3, entityCount: 5 });
    collector.reportFrameTime(4);

    // Second renderer begins its frame — must NOT wipe collector1's totals
    collector2.beginFrame();
    collector2.reportLayer("hud", { drawCalls: 1, entityCount: 2 });
    collector2.reportFrameTime(2);

    expect(stats.totalDrawCalls).toBe(4); // 3 + 1
    expect(stats.totalEntitiesRendered).toBe(7); // 5 + 2
    expect(stats.totalRenderTimeMs).toBeCloseTo(6); // 4 + 2
  });

  it("accumulates totals across multiple renderers", () => {
    const collector2 = new RendererStatsCollectorImpl("renderer:html", stats);
    collector.enable();
    collector2.enable();
    collector.beginFrame();
    collector2.beginFrame();
    collector.reportLayer("game", { drawCalls: 3, entityCount: 5 });
    collector2.reportLayer("hud", { drawCalls: 0, entityCount: 2 });
    collector.reportFrameTime(4);
    collector2.reportFrameTime(1);
    expect(stats.totalDrawCalls).toBe(3);
    expect(stats.totalEntitiesRendered).toBe(7);
    expect(stats.totalRenderTimeMs).toBeCloseTo(5);
  });
});

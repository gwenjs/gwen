/**
 * @file viewports-plugin tests
 *
 * Verifies that createViewportsPlugin correctly registers viewports via
 * ViewportManager on engine:init, including the default fallback.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ViewportRegion } from "@gwenjs/renderer-core";

// ─── Mock @gwenjs/renderer-core ───────────────────────────────────────────────

const mockSet = vi.fn();
const mockVm = { set: mockSet };
const mockGetOrCreate = vi.fn((_engine: unknown) => mockVm);

vi.mock("@gwenjs/renderer-core", () => ({
  getOrCreateViewportManager: (engine: unknown) => mockGetOrCreate(engine),
}));

// Import after mock registration
const { createViewportsPlugin } = await import("../src/viewports-plugin.js");

// ─── Helpers ──────────────────────────────────────────────────────────────────

type HookHandler = (...args: unknown[]) => void;

function makeEngine() {
  const handlers: Record<string, HookHandler[]> = {};
  return {
    hooks: {
      hook(event: string, fn: HookHandler) {
        (handlers[event] ??= []).push(fn);
      },
      async callHook(event: string, ...args: unknown[]) {
        for (const fn of handlers[event] ?? []) fn(...args);
      },
    },
    triggerInit() {
      return this.hooks.callHook("engine:init");
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("createViewportsPlugin", () => {
  beforeEach(() => {
    mockSet.mockClear();
    mockGetOrCreate.mockClear();
  });

  it("registers configured viewports on engine:init", async () => {
    const viewports: Record<string, ViewportRegion> = {
      p1: { x: 0, y: 0, width: 0.5, height: 1 },
      p2: { x: 0.5, y: 0, width: 0.5, height: 1 },
    };

    const plugin = createViewportsPlugin(viewports);
    const engine = makeEngine();
    plugin.setup(engine as never);
    await engine.triggerInit();

    expect(mockSet).toHaveBeenCalledTimes(2);
    expect(mockSet).toHaveBeenCalledWith("p1", viewports.p1);
    expect(mockSet).toHaveBeenCalledWith("p2", viewports.p2);
  });

  it("registers default fullscreen 'main' viewport when no config is provided", async () => {
    const plugin = createViewportsPlugin(undefined);
    const engine = makeEngine();
    plugin.setup(engine as never);
    await engine.triggerInit();

    expect(mockSet).toHaveBeenCalledOnce();
    expect(mockSet).toHaveBeenCalledWith("main", { x: 0, y: 0, width: 1, height: 1 });
  });

  it("registers default fullscreen 'main' viewport when empty map is provided", async () => {
    const plugin = createViewportsPlugin({});
    const engine = makeEngine();
    plugin.setup(engine as never);
    await engine.triggerInit();

    expect(mockSet).toHaveBeenCalledOnce();
    expect(mockSet).toHaveBeenCalledWith("main", { x: 0, y: 0, width: 1, height: 1 });
  });

  it("has name 'gwen:viewports'", () => {
    const plugin = createViewportsPlugin();
    expect(plugin.name).toBe("gwen:viewports");
  });
});

describe("createViewportsPlugin — idempotence via GwenApp", () => {
  it("setupModules replaces existing gwen:viewports plugin on second call", async () => {
    const { GwenApp } = await import("../src/app.js");
    const { resolveConfig } = await import("../src/config.js");

    const app = new GwenApp();
    const config = resolveConfig({});

    await app.setupModules(config);
    const countAfterFirst = app.plugins.filter((p) => p.name === "gwen:viewports").length;

    await app.setupModules(config);
    const countAfterSecond = app.plugins.filter((p) => p.name === "gwen:viewports").length;

    expect(countAfterFirst).toBe(1);
    expect(countAfterSecond).toBe(1);
  });
});

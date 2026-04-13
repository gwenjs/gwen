import { describe, it, expect, vi } from "vitest";
import { ScreenPlugin } from "../../src/screen-plugin.js";
import { getOrCreateScreenService } from "../../src/get-or-create-screen-service.js";
import { StaticSizeProvider } from "../../src/screen-size-providers.js";
import type { GwenEngine, GwenLogger } from "@gwenjs/core";

function makeEngine() {
  const services = new Map<string, unknown>();
  const hooks = new Map<string, ((...args: unknown[]) => void)[]>();
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

  const engine = {
    logger,
    provide: vi.fn((key: string, value: unknown) => {
      services.set(key, value);
    }),
    tryInject: vi.fn((key: string) => services.get(key)),
    inject: vi.fn((key: string) => {
      const v = services.get(key);
      if (!v) throw new Error(`service "${key}" not found`);
      return v;
    }),
    hooks: {
      hook: vi.fn((event: string, fn: (...args: unknown[]) => void) => {
        const list = hooks.get(event) ?? [];
        list.push(fn);
        hooks.set(event, list);
      }),
      callHook: vi.fn((event: string, ...args: unknown[]) => {
        for (const fn of hooks.get(event) ?? []) fn(...args);
      }),
    },
    _fire: (event: string, ...args: unknown[]) => {
      for (const fn of hooks.get(event) ?? []) fn(...args);
    },
  };
  return engine as unknown as GwenEngine & { _fire: (e: string, ...a: unknown[]) => void };
}

describe("ScreenPlugin", () => {
  it("has name gwen:screen", () => {
    const plugin = ScreenPlugin({ sizeProvider: StaticSizeProvider({ width: 800, height: 600 }) });
    expect(plugin.name).toBe("gwen:screen");
  });

  it("provides screenService on setup", () => {
    const engine = makeEngine();
    const plugin = ScreenPlugin({ sizeProvider: StaticSizeProvider({ width: 800, height: 600 }) });
    plugin.setup(engine);
    expect(engine.provide).toHaveBeenCalledWith("screenService", expect.anything());
  });

  it("calls setContainerSize with initial size on engine:init", () => {
    const engine = makeEngine();
    const plugin = ScreenPlugin({ sizeProvider: StaticSizeProvider({ width: 1024, height: 768 }) });
    plugin.setup(engine);

    const svc = getOrCreateScreenService(engine);
    const setSpy = vi.spyOn(svc, "setContainerSize");

    engine._fire("engine:init");
    expect(setSpy).toHaveBeenCalledWith(1024, 768);
  });

  it("removes viewport info on viewport:remove", () => {
    const engine = makeEngine();
    const plugin = ScreenPlugin({ sizeProvider: StaticSizeProvider({ width: 800, height: 600 }) });
    plugin.setup(engine);

    const svc = getOrCreateScreenService(engine);
    engine._fire("engine:init");

    // create an info entry
    const vm = engine.tryInject("viewportManager") as { set: (id: string, r: object) => void };
    vm?.set("main", { x: 0, y: 0, width: 1, height: 1 });
    svc.getOrCreateInfo("main");

    const removeSpy = vi.spyOn(svc, "removeViewport");
    engine._fire("viewport:remove", { id: "main" });
    expect(removeSpy).toHaveBeenCalledWith("main");
  });

  it("calls computeAllBounds on engine:afterTick", () => {
    const engine = makeEngine();
    const plugin = ScreenPlugin({ sizeProvider: StaticSizeProvider({ width: 800, height: 600 }) });
    plugin.setup(engine);

    const svc = getOrCreateScreenService(engine);
    engine._fire("engine:init");
    const spy = vi.spyOn(svc, "computeAllBounds");
    engine._fire("engine:afterTick");
    expect(spy).toHaveBeenCalled();
  });

  // ── Integration: viewport registration order ─────────────────────────────────
  // Regression test for: bootstrap not mounting createViewportsPlugin before ScreenPlugin.
  // If viewport:add fires AFTER engine:init, pixels must still be computed correctly.

  it("pixels are non-zero when viewport is registered via viewport:add after engine:init", () => {
    const engine = makeEngine();
    const plugin = ScreenPlugin({ sizeProvider: StaticSizeProvider({ width: 800, height: 600 }) });
    plugin.setup(engine);

    const svc = getOrCreateScreenService(engine);
    const info = svc.getOrCreateInfo("main");

    // engine:init fires first — 'main' not in VM yet → pixels stay 0
    engine._fire("engine:init");
    expect(info.pixels.width).toBe(0);

    // viewport:add fires (viewports plugin hooks engine:init and calls vm.set after screen plugin)
    // ScreenPlugin's viewport:add handler calls setContainerSize again → pixels updated
    const vm = engine.tryInject("viewportManager") as { set: (id: string, r: object) => void };
    vm.set("main", { x: 0, y: 0, width: 1, height: 1 });
    // viewport:add is emitted by ViewportManagerImpl.set() → triggers ScreenPlugin hook
    engine._fire("viewport:add", { id: "main", region: { x: 0, y: 0, width: 1, height: 1 } });

    expect(info.pixels.width).toBe(800);
    expect(info.pixels.height).toBe(600);
  });

  it("warn with SCREEN:VIEWPORT_NOT_FOUND code when useScreen() uses an unknown viewport id", () => {
    const engine = makeEngine();
    const plugin = ScreenPlugin({ sizeProvider: StaticSizeProvider({ width: 800, height: 600 }) });
    plugin.setup(engine);

    const svc = getOrCreateScreenService(engine);
    engine._fire("engine:init");

    // register 'main' so the service has a known viewport
    const vm = engine.tryInject("viewportManager") as { set: (id: string, r: object) => void };
    vm.set("main", { x: 0, y: 0, width: 1, height: 1 });
    engine._fire("viewport:add", { id: "main", region: { x: 0, y: 0, width: 1, height: 1 } });

    // accessing unknown viewport after container size is known should warn
    const warnSpy = vi.spyOn(engine.logger.child("renderer-core:screen"), "warn");
    svc.getOrCreateInfo("typo-viewport");
    // setContainerSize re-run to trigger the warning path
    svc.setContainerSize(800, 600);

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("SCREEN:VIEWPORT_NOT_FOUND"));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("typo-viewport"));
  });
});

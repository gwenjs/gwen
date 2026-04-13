import { describe, it, expect, vi } from "vitest";
import { ScreenServiceImpl } from "../../src/screen-service.js";
import { ViewportManagerImpl } from "../../src/viewport-manager.js";
import type { GwenLogger } from "@gwenjs/core";

function makeLogger(): GwenLogger {
  const child: GwenLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
    setSink: vi.fn(),
  };
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnValue(child),
    setSink: vi.fn(),
  };
}

function makeVm() {
  return new ViewportManagerImpl(vi.fn());
}

describe("ScreenServiceImpl — pixels", () => {
  it("getOrCreateInfo() returns info with zero pixels before container size is set", () => {
    const vm = makeVm();
    vm.set("main", { x: 0, y: 0, width: 1, height: 1 });
    const svc = new ScreenServiceImpl(makeLogger(), vm);
    const info = svc.getOrCreateInfo("main");
    expect(info.pixels.width).toBe(0);
    expect(info.pixels.height).toBe(0);
  });

  it("getOrCreateInfo() computes pixels from container size × region", () => {
    const vm = makeVm();
    vm.set("main", { x: 0, y: 0, width: 1, height: 1 });
    const svc = new ScreenServiceImpl(makeLogger(), vm);
    svc.setContainerSize(800, 600);
    const info = svc.getOrCreateInfo("main");
    expect(info.pixels.width).toBe(800);
    expect(info.pixels.height).toBe(600);
  });

  it("getOrCreateInfo() computes pixels for a partial viewport region", () => {
    const vm = makeVm();
    vm.set("p1", { x: 0, y: 0, width: 0.5, height: 1 });
    const svc = new ScreenServiceImpl(makeLogger(), vm);
    svc.setContainerSize(1000, 600);
    const info = svc.getOrCreateInfo("p1");
    expect(info.pixels.width).toBe(500);
    expect(info.pixels.height).toBe(600);
  });

  it("setContainerSize() updates existing infos in place (same reference)", () => {
    const vm = makeVm();
    vm.set("main", { x: 0, y: 0, width: 1, height: 1 });
    const svc = new ScreenServiceImpl(makeLogger(), vm);
    svc.setContainerSize(800, 600);
    const info = svc.getOrCreateInfo("main");
    svc.setContainerSize(1024, 768);
    expect(info.pixels.width).toBe(1024);
    expect(info.pixels.height).toBe(768);
  });

  it("getOrCreateInfo() returns the same reference on repeated calls", () => {
    const vm = makeVm();
    vm.set("main", { x: 0, y: 0, width: 1, height: 1 });
    const svc = new ScreenServiceImpl(makeLogger(), vm);
    expect(svc.getOrCreateInfo("main")).toBe(svc.getOrCreateInfo("main"));
  });

  it("getOrCreateInfo() for unknown viewport returns info with zero pixels (optimistic)", () => {
    const vm = makeVm();
    const svc = new ScreenServiceImpl(makeLogger(), vm);
    svc.setContainerSize(800, 600);
    // viewport not in VM yet — optimistic creation
    const info = svc.getOrCreateInfo("unknown");
    expect(info.pixels.width).toBe(0);
    expect(info.pixels.height).toBe(0);
  });

  it("setContainerSize() updates pixels for viewport added after info creation", () => {
    const vm = makeVm();
    const svc = new ScreenServiceImpl(makeLogger(), vm);
    svc.setContainerSize(800, 600);
    // info created before viewport is registered
    const info = svc.getOrCreateInfo("late");
    expect(info.pixels.width).toBe(0);
    // now register the viewport and refresh
    vm.set("late", { x: 0, y: 0, width: 1, height: 1 });
    svc.setContainerSize(800, 600);
    expect(info.pixels.width).toBe(800);
  });

  it("removeViewport() stops updating the removed entry", () => {
    const vm = makeVm();
    vm.set("main", { x: 0, y: 0, width: 1, height: 1 });
    const svc = new ScreenServiceImpl(makeLogger(), vm);
    svc.setContainerSize(800, 600);
    const info = svc.getOrCreateInfo("main");
    svc.removeViewport("main");
    svc.setContainerSize(1024, 768);
    // info is no longer updated
    expect(info.pixels.width).toBe(800);
  });
});

describe("ScreenServiceImpl — bounds provider", () => {
  it("hasBoundsProvider() returns false initially", () => {
    const svc = new ScreenServiceImpl(makeLogger(), makeVm());
    expect(svc.hasBoundsProvider()).toBe(false);
  });

  it("hasBoundsProvider() returns true after registration", () => {
    const svc = new ScreenServiceImpl(makeLogger(), makeVm());
    svc.registerBoundsProvider({ compute: () => undefined });
    expect(svc.hasBoundsProvider()).toBe(true);
  });

  it("computeBoundsFor() calls the provider with correct args", () => {
    const svc = new ScreenServiceImpl(makeLogger(), makeVm());
    const provider = {
      compute: vi.fn().mockReturnValue({ minX: -400, maxX: 400, minY: -300, maxY: 300 }),
    };
    svc.registerBoundsProvider(provider);
    const result = svc.computeBoundsFor("main", 800, 600);
    expect(provider.compute).toHaveBeenCalledWith("main", 800, 600);
    expect(result).toEqual({ minX: -400, maxX: 400, minY: -300, maxY: 300 });
  });

  it("computeBoundsFor() returns undefined when no provider registered", () => {
    const svc = new ScreenServiceImpl(makeLogger(), makeVm());
    expect(svc.computeBoundsFor("main", 800, 600)).toBeUndefined();
  });

  it("computeAllBounds() mutates bounds in place on existing infos", () => {
    const vm = makeVm();
    vm.set("main", { x: 0, y: 0, width: 1, height: 1 });
    const svc = new ScreenServiceImpl(makeLogger(), vm);
    svc.setContainerSize(800, 600);
    const info = svc.getOrCreateInfo("main");
    expect(info.bounds).toBeUndefined();

    svc.registerBoundsProvider({
      compute: () => ({ minX: -400, maxX: 400, minY: -300, maxY: 300 }),
    });
    svc.computeAllBounds();
    expect(info.bounds).toBeDefined();
    expect(info.bounds?.minX).toBe(-400);
    expect(info.bounds?.maxX).toBe(400);

    // second call mutates in place — same reference
    const boundsRef = info.bounds;
    svc.computeAllBounds();
    expect(info.bounds).toBe(boundsRef);
  });

  it("computeAllBounds() sets bounds to undefined when provider returns undefined", () => {
    const vm = makeVm();
    vm.set("main", { x: 0, y: 0, width: 1, height: 1 });
    const svc = new ScreenServiceImpl(makeLogger(), vm);
    svc.setContainerSize(800, 600);
    const info = svc.getOrCreateInfo("main");

    const provider = {
      compute: vi.fn().mockReturnValue({ minX: -400, maxX: 400, minY: -300, maxY: 300 }),
    };
    svc.registerBoundsProvider(provider);
    svc.computeAllBounds();
    expect(info.bounds).toBeDefined();

    provider.compute.mockReturnValue(undefined);
    svc.computeAllBounds();
    expect(info.bounds).toBeUndefined();
  });

  it("computeAllBounds() is a no-op when no provider is registered", () => {
    const vm = makeVm();
    vm.set("main", { x: 0, y: 0, width: 1, height: 1 });
    const svc = new ScreenServiceImpl(makeLogger(), vm);
    svc.setContainerSize(800, 600);
    const info = svc.getOrCreateInfo("main");
    svc.computeAllBounds(); // no provider — should not throw
    expect(info.bounds).toBeUndefined();
  });
});

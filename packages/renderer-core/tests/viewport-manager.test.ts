// packages/renderer-core/tests/viewport-manager.test.ts
import { describe, it, expect, vi } from "vitest";
import { ViewportManagerImpl } from "../src/viewport-manager.js";
import type { ViewportRegion } from "../src/camera-types.js";

function makeRegion(x = 0, y = 0, width = 1, height = 1): ViewportRegion {
  return { x, y, width, height };
}

describe("ViewportManagerImpl", () => {
  it("get() returns undefined for unknown id", () => {
    const mgr = new ViewportManagerImpl(vi.fn());
    expect(mgr.get("main")).toBeUndefined();
  });

  it("set() stores a viewport context accessible via get()", () => {
    const mgr = new ViewportManagerImpl(vi.fn());
    mgr.set("main", makeRegion());
    const ctx = mgr.get("main");
    expect(ctx).toBeDefined();
    expect(ctx?.id).toBe("main");
    expect(ctx?.region).toEqual(makeRegion());
  });

  it("set() emits viewport:add on first registration", () => {
    const callHook = vi.fn();
    const mgr = new ViewportManagerImpl(callHook);
    mgr.set("main", makeRegion());
    expect(callHook).toHaveBeenCalledWith("viewport:add", { id: "main", region: makeRegion() });
  });

  it("set() emits viewport:resize on subsequent call with same id", () => {
    const callHook = vi.fn();
    const mgr = new ViewportManagerImpl(callHook);
    const r1 = makeRegion(0, 0, 1, 1);
    const r2 = makeRegion(0, 0, 0.5, 1);
    mgr.set("main", r1);
    callHook.mockClear();
    mgr.set("main", r2);
    expect(callHook).toHaveBeenCalledWith("viewport:resize", { id: "main", region: r2 });
    expect(callHook).not.toHaveBeenCalledWith("viewport:add", expect.anything());
  });

  it("remove() emits viewport:remove and clears the entry", () => {
    const callHook = vi.fn();
    const mgr = new ViewportManagerImpl(callHook);
    mgr.set("main", makeRegion());
    callHook.mockClear();
    mgr.remove("main");
    expect(callHook).toHaveBeenCalledWith("viewport:remove", { id: "main" });
    expect(mgr.get("main")).toBeUndefined();
  });

  it("remove() is a no-op for unknown id (no hook emitted)", () => {
    const callHook = vi.fn();
    const mgr = new ViewportManagerImpl(callHook);
    mgr.remove("unknown");
    expect(callHook).not.toHaveBeenCalled();
  });

  it("getAll() returns all registered viewports", () => {
    const mgr = new ViewportManagerImpl(vi.fn());
    mgr.set("p1", makeRegion(0, 0, 0.5, 1));
    mgr.set("p2", makeRegion(0.5, 0, 0.5, 1));
    expect(mgr.getAll().size).toBe(2);
  });
});

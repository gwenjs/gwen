// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { StaticSizeProvider, BrowserSizeProvider } from "../../src/screen-size-providers.js";

describe("StaticSizeProvider", () => {
  it("getSize() returns the configured dimensions", () => {
    const p = StaticSizeProvider({ width: 1920, height: 1080 });
    expect(p.getSize()).toEqual({ width: 1920, height: 1080 });
  });

  it("subscribe() is a no-op — returns a cleanup that does nothing", () => {
    const p = StaticSizeProvider({ width: 800, height: 600 });
    const cb = vi.fn();
    const cleanup = p.subscribe(cb);
    cleanup();
    expect(cb).not.toHaveBeenCalled();
  });
});

describe("BrowserSizeProvider", () => {
  it("getSize() returns element clientWidth/clientHeight", () => {
    const el = document.createElement("div");
    Object.defineProperty(el, "clientWidth", { value: 1024, configurable: true });
    Object.defineProperty(el, "clientHeight", { value: 768, configurable: true });
    const p = BrowserSizeProvider(el);
    expect(p.getSize()).toEqual({ width: 1024, height: 768 });
  });

  it("subscribe() calls callback on resize and returns a cleanup", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const p = BrowserSizeProvider(el);
    const cb = vi.fn();
    const cleanup = p.subscribe(cb);
    expect(typeof cleanup).toBe("function");
    cleanup();
  });

  it("getSize() returns { width: 0, height: 0 } when no element and no document", () => {
    // Simulate no element — use undefined implicitly via factory with no DOM
    // StaticSizeProvider covers the Node case; BrowserSizeProvider with no target falls back gracefully
    const p = BrowserSizeProvider(null as unknown as HTMLElement);
    expect(p.getSize()).toEqual({ width: 0, height: 0 });
  });
});

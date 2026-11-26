// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEngine } from "@gwenjs/core/node";
import type { GwenEngine } from "@gwenjs/core";
import { ScreenPlugin } from "../../src/screen-plugin.js";
import type { ScreenSizeProvider } from "../../src/screen-size-providers.js";
import { BrowserSizeProvider, StaticSizeProvider } from "../../src/screen-size-providers.js";
import { MockSizeProvider } from "../../src/testing/mock-size-provider.js";
import { renderHost } from "../helpers/render-host.js";

const engines: GwenEngine[] = [];
const roots: HTMLElement[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  for (const engine of engines.splice(0)) await engine.stop();
  for (const root of roots.splice(0)) root.remove();
});

describe("size providers report the device pixel ratio", () => {
  it("StaticSizeProvider reports an explicit dpr in getSize", () => {
    const size = { width: 800, height: 600, dpr: 2 };
    expect(StaticSizeProvider(size).getSize()).toEqual({ width: 800, height: 600, dpr: 2 });
  });

  it("BrowserSizeProvider reports window.devicePixelRatio in getSize and in every callback", () => {
    vi.stubGlobal("devicePixelRatio", 3);
    let observed: ((entries: unknown[]) => void) | undefined;
    class StubResizeObserver {
      constructor(callback: (entries: unknown[]) => void) {
        observed = callback;
      }
      observe(): void {}
      disconnect(): void {}
    }
    vi.stubGlobal("ResizeObserver", StubResizeObserver);
    const element = document.createElement("div");
    Object.defineProperty(element, "clientWidth", { value: 640 });
    Object.defineProperty(element, "clientHeight", { value: 480 });
    const provider = BrowserSizeProvider(element);
    expect(provider.getSize()).toEqual({ width: 640, height: 480, dpr: 3 });
    const seen: Array<Array<number | undefined>> = [];
    provider.subscribe((...args: Array<number | undefined>) => {
      seen.push(args);
    });
    observed?.([{ contentRect: { width: 300, height: 200 } }]);
    expect(seen).toEqual([[300, 200, 3]]);
  });

  function providerWithDpr(value: number | undefined): ScreenSizeProvider {
    vi.stubGlobal("devicePixelRatio", value);
    const element = document.createElement("div");
    Object.defineProperty(element, "clientWidth", { value: 640 });
    Object.defineProperty(element, "clientHeight", { value: 480 });
    return BrowserSizeProvider(element);
  }

  it("BrowserSizeProvider falls back to a dpr of 1 when devicePixelRatio is 0", () => {
    expect(providerWithDpr(0).getSize()).toEqual({ width: 640, height: 480, dpr: 1 });
  });

  it("BrowserSizeProvider falls back to a dpr of 1 when devicePixelRatio is negative", () => {
    expect(providerWithDpr(-2).getSize()).toEqual({ width: 640, height: 480, dpr: 1 });
  });

  it("BrowserSizeProvider falls back to a dpr of 1 when devicePixelRatio is undefined", () => {
    expect(providerWithDpr(undefined).getSize()).toEqual({ width: 640, height: 480, dpr: 1 });
  });

  it("MockSizeProvider.emit forwards the dpr and keeps the previous one when it is omitted", () => {
    const initial = { width: 800, height: 600, dpr: 1 };
    const provider = MockSizeProvider(initial);
    const emit: (width: number, height: number, dpr?: number) => void = provider.emit;
    const seen: Array<Array<number | undefined>> = [];
    provider.subscribe((...args: Array<number | undefined>) => {
      seen.push(args);
    });
    emit(1024, 768, 2);
    emit(1280, 720);
    expect(seen).toEqual([
      [1024, 768, 2],
      [1280, 720, 2],
    ]);
  });
});

async function startWith(provider: ScreenSizeProvider): Promise<GwenEngine> {
  const engine = await createEngine({ maxEntities: 32 });
  engines.push(engine);
  const root = document.createElement("div");
  document.body.appendChild(root);
  roots.push(root);
  await engine.use(renderHost({ container: root }));
  await engine.use(ScreenPlugin({ sizeProvider: provider }));
  await engine.startExternal();
  return engine;
}

describe("ScreenPlugin applies the device pixel ratio", () => {
  it("passes the dpr of getSize to the screen service at engine:init", async () => {
    const size = { width: 1024, height: 768, dpr: 2 };
    const engine = await startWith({ getSize: () => size, subscribe: () => () => {} });
    expect(engine.inject("screenService").devicePixelRatio).toBe(2);
  });

  it("keeps a dpr of 1 when the provider reports none", async () => {
    const engine = await startWith(StaticSizeProvider({ width: 1024, height: 768 }));
    expect(engine.inject("screenService").devicePixelRatio).toBe(1);
  });
});

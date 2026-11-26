/**
 * @file Test support for the render host tests.
 *
 * `renderHost` reads `RenderHostPlugin` from the package root at call time, so a test file
 * loads (and fails on an assertion, not on an import) while the export is absent.
 */
import { expect } from "vitest";
import { definePlugin } from "@gwenjs/kit/plugin";
import type { GwenEngineBase, GwenPlugin } from "@gwenjs/schema";
import * as rendererCore from "../../src/index.js";
import { RENDERER_CONTRACT_VERSION } from "../../src/types.js";
import type { RendererService, SurfaceRendererService } from "../../src/types.js";

/** What `RenderHostPlugin(options)` returns: a plugin that declares its provided keys. */
export type RenderHost = GwenPlugin & { readonly provides: readonly string[] };

/** Options of the host, spelled out so the tests compile before the export exists. */
export interface RenderHostTestOptions {
  container?: HTMLElement | undefined;
  viewports?: Record<string, { x: number; y: number; width: number; height: number }> | undefined;
}

/** `RenderHostPlugin(options)` read from the package root. Fails on an assertion when absent. */
export function renderHost(options: RenderHostTestOptions = {}): RenderHost {
  const factory: unknown = Reflect.get(rendererCore, "RenderHostPlugin");
  expect(typeof factory, "RenderHostPlugin export").toBe("function");
  if (typeof factory !== "function") throw new TypeError("RenderHostPlugin is not exported");
  return factory(options);
}

/** Everything a surface renderer saw. */
export interface SurfaceRecord {
  mounts: number;
  unmounts: number;
  collectors: number;
  resizes: Array<[number, number, number]>;
  renders: Array<{ views: number; alpha: number }>;
  canvas: HTMLCanvasElement | null;
}

export function recorder(): SurfaceRecord {
  return { mounts: 0, unmounts: 0, collectors: 0, resizes: [], renders: [], canvas: null };
}

/**
 * A surface renderer with one world layer `scene`. It creates its canvas in `mount()`.
 * `failMount` makes `mount()` throw that value after it counted the call.
 * `failUnmount` makes `unmount()` throw that value after it counted the call, before it
 * removes its canvas: the host must remove that node itself.
 */
export function surface(
  name: string,
  order: number,
  rec: SurfaceRecord,
  failMount?: { readonly error: unknown },
  failUnmount?: { readonly error: unknown },
): SurfaceRendererService {
  return {
    name,
    contractVersion: RENDERER_CONTRACT_VERSION,
    kind: "surface",
    layers: { scene: { order, coordinate: "world" } },
    mount(container) {
      rec.mounts += 1;
      if (failMount !== undefined) throw failMount.error;
      rec.canvas = container.ownerDocument.createElement("canvas");
      container.appendChild(rec.canvas);
    },
    unmount() {
      rec.unmounts += 1;
      if (failUnmount !== undefined) throw failUnmount.error;
      rec.canvas?.remove();
      rec.canvas = null;
    },
    resize(width, height, dpr) {
      rec.resizes.push([width, height, dpr]);
    },
    getLayerElement() {
      if (rec.canvas === null) throw new Error("canvas is created in mount()");
      return rec.canvas;
    },
    setStatsCollector() {
      rec.collectors += 1;
    },
    renderViews(views, alpha) {
      rec.renders.push({ views: views.length, alpha });
    },
  };
}

/**
 * A plugin that registers `service` on the declared `layerManager` and nothing else.
 * With `withTeardown` it unregisters the service at teardown, like a well-behaved plugin.
 */
export function rendererPlugin(service: RendererService, withTeardown: boolean): GwenPlugin {
  let host: GwenEngineBase | undefined;
  return definePlugin({ provides: [] }, () => ({
    name: `plugin:${service.name}`,
    requires: { services: ["layerManager"] },
    setup(engine: GwenEngineBase) {
      host = engine;
      engine.inject("layerManager").register(service);
    },
    ...(withTeardown
      ? {
          teardown() {
            host?.inject("layerManager").unregister(service.name);
          },
        }
      : {}),
  }))();
}

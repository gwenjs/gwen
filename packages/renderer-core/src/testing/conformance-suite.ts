/**
 * @file Conformance checks for RendererService implementations.
 *
 * `runConformanceTests` is synchronous and does not call mount or unmount.
 * `runSurfaceConformance` extends it and does call mount, unmount, resize, and renderViews.
 */

import type { GwenEngine } from "@gwenjs/core";
import { RENDERER_CONTRACT_VERSION } from "../types.js";
import type { RendererService, RenderView, SurfaceRendererService } from "../types.js";

/**
 * Throws a descriptive error if `service` violates the RendererService contract.
 * Does NOT call mount(), unmount(), or resize() — safe to call in any context.
 *
 * @param service - The RendererService implementation to validate.
 * @throws {Error} With a detailed message describing the first violation found.
 *
 * @example
 * ```ts
 * // In your renderer plugin's test suite:
 * import { runConformanceTests } from '@gwenjs/renderer-core/testing'
 * runConformanceTests(MyRendererPlugin({ layers: { game: { order: 0 } } }))
 * ```
 */
export function runConformanceTests(service: RendererService): void {
  assertContractVersion(service);
  assertHasLayers(service);
  assertRequiredMethods(service);
  assertLayerElementsAccessible(service);
}

function assertContractVersion(service: RendererService): void {
  if (service.contractVersion !== RENDERER_CONTRACT_VERSION) {
    throw new Error(
      `[runConformanceTests] "${service.name}" contractVersion is ${service.contractVersion}, ` +
        `expected ${RENDERER_CONTRACT_VERSION}. ` +
        `Update the renderer plugin or @gwenjs/renderer-core to matching versions.`,
    );
  }
}

function assertHasLayers(service: RendererService): void {
  const layerCount = Object.keys(service.layers).length;
  if (layerCount === 0) {
    throw new Error(
      `[runConformanceTests] "${service.name}" declares zero layers. ` +
        `At least one layer is required. Add a layers entry to the renderer config.`,
    );
  }
}

function assertRequiredMethods(service: RendererService): void {
  const required: Array<keyof RendererService> = ["mount", "unmount", "resize", "getLayerElement"];
  for (const method of required) {
    if (typeof (service as unknown as Record<string, unknown>)[method as string] !== "function") {
      throw new Error(
        `[runConformanceTests] "${service.name}" is missing required method "${method}". ` +
          `Implement it to satisfy the RendererService contract.`,
      );
    }
  }
}

function assertLayerElementsAccessible(service: RendererService): void {
  for (const layerName of Object.keys(service.layers)) {
    try {
      const el = service.getLayerElement(layerName);
      if (!el || !(el instanceof Element)) {
        throw new Error(`getLayerElement("${layerName}") did not return an Element`);
      }
    } catch (cause) {
      throw new Error(
        `[runConformanceTests] "${service.name}" getLayerElement("${layerName}") threw: ${cause}. ` +
          `getLayerElement() must return a valid DOM element for every declared layer.`,
      );
    }
  }
}

/**
 * Surface-renderer checks on top of {@link runConformanceTests}.
 * Confirms kind, one world layer, canvas ownership, dpr on resize, and `renderViews` for 0, 1, and 2 views.
 *
 * @param service - Surface renderer under test.
 * @param engine - Engine whose screen service holds the device pixel ratio.
 * @throws {Error} On the first violation.
 */
export function runSurfaceConformance(service: SurfaceRendererService, engine: GwenEngine): void {
  runConformanceTests(service);
  if (service.kind !== "surface") {
    throw new Error(
      `[runSurfaceConformance] "${service.name}" kind is ${String(service.kind)}, expected "surface".`,
    );
  }

  const layerNames = Object.keys(service.layers);
  if (layerNames.length !== 1) {
    throw new Error(
      `[runSurfaceConformance] "${service.name}" declares ${layerNames.length} layers. ` +
        `A surface renderer must declare exactly one.`,
    );
  }
  const layerName = layerNames[0];
  if (layerName === undefined) {
    throw new Error(`[runSurfaceConformance] "${service.name}" declares no layer.`);
  }
  const layer = service.layers[layerName];
  if (layer === undefined || layer.coordinate !== "world") {
    throw new Error(
      `[runSurfaceConformance] "${service.name}" layer "${layerName}" must use coordinate "world".`,
    );
  }
  if (typeof service.renderViews !== "function") {
    throw new Error(
      `[runSurfaceConformance] "${service.name}" is missing required method "renderViews".`,
    );
  }

  const canvas = service.getLayerElement(layerName);
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error(
      `[runSurfaceConformance] "${service.name}" getLayerElement("${layerName}") must return an HTMLCanvasElement.`,
    );
  }

  const container = document.createElement("div");
  document.body.appendChild(container);
  let mounted = false;
  try {
    service.mount(container);
    mounted = true;
    if (!canvas.isConnected) {
      throw new Error(
        `[runSurfaceConformance] "${service.name}" did not attach its canvas during mount().`,
      );
    }
    service.unmount();
    mounted = false;
    if (canvas.isConnected) {
      throw new Error(
        `[runSurfaceConformance] "${service.name}" left its canvas attached after unmount().`,
      );
    }
  } finally {
    if (mounted) service.unmount();
    container.remove();
  }

  const dpr = readConformanceDpr(engine);
  const cssW = 320;
  const cssH = 180;
  service.resize(cssW, cssH);
  const sized = service.getLayerElement(layerName);
  if (!(sized instanceof HTMLCanvasElement)) {
    throw new Error(
      `[runSurfaceConformance] "${service.name}" getLayerElement("${layerName}") must return an HTMLCanvasElement.`,
    );
  }
  const expectW = Math.round(cssW * dpr);
  const expectH = Math.round(cssH * dpr);
  if (sized.width !== expectW || sized.height !== expectH) {
    throw new Error(
      `[runSurfaceConformance] "${service.name}" resize(${cssW}, ${cssH}) ` +
        `left the canvas at ${sized.width}×${sized.height}, expected ${expectW}×${expectH} (dpr ${dpr}).`,
    );
  }

  const views: RenderView[] = [
    makeConformanceView("main", "left"),
    makeConformanceView("main", "right"),
  ];
  const alphas = [0, 0.5, 1];
  for (let n = 0; n < 3; n++) {
    try {
      service.renderViews(views.slice(0, n), alphas[n] ?? 0);
    } catch (cause) {
      throw new Error(
        `[runSurfaceConformance] "${service.name}" renderViews with ${n} views threw: ${String(cause)}`,
      );
    }
  }
}

function readConformanceDpr(engine: GwenEngine): number {
  const screen = engine.tryInject("screenService");
  if (screen === undefined) {
    throw new Error(
      `[runSurfaceConformance] screenService is missing. Set a device pixel ratio before checking resize.`,
    );
  }
  const viewports = engine.tryInject("viewportManager");
  let viewportId = "__surface_conformance__";
  if (viewports !== undefined) {
    const first = viewports.getAll().keys().next().value;
    if (typeof first === "string") viewportId = first;
  }
  const dpr = screen.getOrCreateInfo(viewportId).dpr;
  if (!(dpr > 0) || !Number.isFinite(dpr)) {
    throw new Error(
      `[runSurfaceConformance] ViewportScreenInfo.dpr is ${dpr}. Set a positive dpr.`,
    );
  }
  return dpr;
}

function makeConformanceView(viewportId: string, eye: RenderView["eye"]): RenderView {
  return {
    viewportId,
    eye,
    viewMatrix: new Float32Array(16),
    projectionMatrix: new Float32Array(16),
    pixelRect: { x: 0, y: 0, width: 1, height: 1 },
  };
}

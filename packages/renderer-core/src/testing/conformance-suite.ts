/**
 * @file Conformance checks for RendererService implementations.
 *
 * `runConformanceTests` is synchronous and does not call mount or unmount.
 * `runSurfaceConformance` extends it and does call mount, unmount, resize, and renderViews.
 */

import type { GwenEngine } from "@gwenjs/core";
import { GwenError } from "@gwenjs/schema";
import { RendererErrorCodes } from "../errors.js";
import { RENDERER_CONTRACT_VERSION } from "../types.js";
import type { RendererService, RenderView, SurfaceRendererService } from "../types.js";

/**
 * Throws a descriptive error if `service` violates the RendererService contract.
 * Does NOT call mount(), unmount(), or resize() — safe to call in any context.
 *
 * @param service - The RendererService implementation to validate.
 * @throws {GwenError} With a detailed message describing the first violation found.
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
    throw new GwenError(
      RendererErrorCodes.CONFORMANCE_FAILED,
      `"${service.name}" contractVersion is ${service.contractVersion}, expected ${RENDERER_CONTRACT_VERSION}.`,
      {
        composable: "runConformanceTests",
        hint: __GWEN_DEV__
          ? "Update the renderer plugin or @gwenjs/renderer-core to matching versions."
          : undefined,
      },
    );
  }
}

function assertHasLayers(service: RendererService): void {
  const layerCount = Object.keys(service.layers).length;
  if (layerCount === 0) {
    throw new GwenError(
      RendererErrorCodes.CONFORMANCE_FAILED,
      `"${service.name}" declares zero layers.`,
      {
        composable: "runConformanceTests",
        hint: __GWEN_DEV__
          ? "At least one layer is required. Add a layers entry to the renderer config."
          : undefined,
      },
    );
  }
}

function assertRequiredMethods(service: RendererService): void {
  const required: Array<keyof RendererService> = ["mount", "unmount", "resize", "getLayerElement"];
  for (const method of required) {
    if (typeof service[method] !== "function") {
      throw new GwenError(
        RendererErrorCodes.CONFORMANCE_FAILED,
        `"${service.name}" is missing required method "${method}".`,
        {
          composable: "runConformanceTests",
          hint: __GWEN_DEV__ ? "Implement it to satisfy the RendererService contract." : undefined,
        },
      );
    }
  }
}

function assertLayerElementsAccessible(service: RendererService): void {
  // A surface canvas is created in mount() and does not exist yet.
  // runSurfaceConformance reads it after mount.
  if (service.kind === "surface") return;
  for (const layerName of Object.keys(service.layers)) {
    let el: unknown;
    try {
      el = service.getLayerElement(layerName);
    } catch (cause) {
      throw new GwenError(
        RendererErrorCodes.CONFORMANCE_FAILED,
        `"${service.name}" getLayerElement("${layerName}") threw: ${cause}.`,
        {
          composable: "runConformanceTests",
          cause,
          hint: __GWEN_DEV__
            ? "getLayerElement() must return a valid DOM element for every declared layer."
            : undefined,
        },
      );
    }
    if (!el || !(el instanceof Element)) {
      throw new GwenError(
        RendererErrorCodes.CONFORMANCE_FAILED,
        `"${service.name}" getLayerElement("${layerName}") did not return an Element.`,
        {
          composable: "runConformanceTests",
          hint: __GWEN_DEV__ ? "Return an Element for every declared layer." : undefined,
        },
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
 * @throws {GwenError} On the first violation.
 */
export function runSurfaceConformance(service: SurfaceRendererService, engine: GwenEngine): void {
  runConformanceTests(service);
  if (service.kind !== "surface") {
    throw new GwenError(
      RendererErrorCodes.CONFORMANCE_FAILED,
      `"${service.name}" kind is ${String(service.kind)}, expected "surface".`,
      { composable: "runSurfaceConformance" },
    );
  }

  const layerNames = Object.keys(service.layers);
  if (layerNames.length !== 1) {
    throw new GwenError(
      RendererErrorCodes.CONFORMANCE_FAILED,
      `"${service.name}" declares ${layerNames.length} layers.`,
      {
        composable: "runSurfaceConformance",
        hint: __GWEN_DEV__ ? "A surface renderer must declare exactly one." : undefined,
      },
    );
  }
  const layerName = layerNames[0];
  if (layerName === undefined) {
    throw new GwenError(
      RendererErrorCodes.CONFORMANCE_FAILED,
      `"${service.name}" declares no layer.`,
      { composable: "runSurfaceConformance" },
    );
  }
  const layer = service.layers[layerName];
  if (layer === undefined || layer.coordinate !== "world") {
    throw new GwenError(
      RendererErrorCodes.CONFORMANCE_FAILED,
      `"${service.name}" layer "${layerName}" must use coordinate "world".`,
      { composable: "runSurfaceConformance" },
    );
  }
  if (typeof service.renderViews !== "function") {
    throw new GwenError(
      RendererErrorCodes.CONFORMANCE_FAILED,
      `"${service.name}" is missing required method "renderViews".`,
      { composable: "runSurfaceConformance" },
    );
  }

  const dpr = readConformanceDpr(engine);
  const cssW = 320;
  const cssH = 180;
  const container = document.createElement("div");
  document.body.appendChild(container);
  let mounted = false;
  try {
    service.mount(container);
    mounted = true;
    const canvas = service.getLayerElement(layerName);
    if (!(canvas instanceof HTMLCanvasElement)) {
      throw new GwenError(
        RendererErrorCodes.CONFORMANCE_FAILED,
        `"${service.name}" getLayerElement("${layerName}") must return an HTMLCanvasElement.`,
        { composable: "runSurfaceConformance" },
      );
    }
    if (!canvas.isConnected) {
      throw new GwenError(
        RendererErrorCodes.CONFORMANCE_FAILED,
        `"${service.name}" did not attach its canvas during mount().`,
        { composable: "runSurfaceConformance" },
      );
    }
    service.resize(cssW, cssH, dpr);
    const sized = service.getLayerElement(layerName);
    if (!(sized instanceof HTMLCanvasElement)) {
      throw new GwenError(
        RendererErrorCodes.CONFORMANCE_FAILED,
        `"${service.name}" getLayerElement("${layerName}") must return an HTMLCanvasElement.`,
        { composable: "runSurfaceConformance" },
      );
    }
    const expectW = Math.round(cssW * dpr);
    const expectH = Math.round(cssH * dpr);
    if (sized.width !== expectW || sized.height !== expectH) {
      throw new GwenError(
        RendererErrorCodes.CONFORMANCE_FAILED,
        `"${service.name}" resize(${cssW}, ${cssH}, ${dpr}) left the canvas at ${sized.width}×${sized.height}, expected ${expectW}×${expectH} (dpr ${dpr}).`,
        { composable: "runSurfaceConformance" },
      );
    }
    service.unmount();
    mounted = false;
    if (canvas.isConnected) {
      throw new GwenError(
        RendererErrorCodes.CONFORMANCE_FAILED,
        `"${service.name}" left its canvas attached after unmount().`,
        { composable: "runSurfaceConformance" },
      );
    }
  } finally {
    if (mounted) service.unmount();
    container.remove();
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
      throw new GwenError(
        RendererErrorCodes.CONFORMANCE_FAILED,
        `"${service.name}" renderViews with ${n} views threw: ${String(cause)}.`,
        { composable: "runSurfaceConformance", cause },
      );
    }
  }
}

function readConformanceDpr(engine: GwenEngine): number {
  const screen = engine.tryInject("screenService");
  if (screen === undefined) {
    throw new GwenError(RendererErrorCodes.CONFORMANCE_FAILED, "screenService is missing.", {
      composable: "runSurfaceConformance",
      hint: __GWEN_DEV__ ? "Set a device pixel ratio before checking resize." : undefined,
    });
  }
  const viewports = engine.tryInject("viewportManager");
  let viewportId = "__surface_conformance__";
  if (viewports !== undefined) {
    const first = viewports.getAll().keys().next().value;
    if (typeof first === "string") viewportId = first;
  }
  const dpr = screen.getOrCreateInfo(viewportId).dpr;
  if (!(dpr > 0) || !Number.isFinite(dpr)) {
    throw new GwenError(
      RendererErrorCodes.CONFORMANCE_FAILED,
      `ViewportScreenInfo.dpr is ${dpr}.`,
      {
        composable: "runSurfaceConformance",
        hint: __GWEN_DEV__ ? "Set a positive dpr." : undefined,
      },
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

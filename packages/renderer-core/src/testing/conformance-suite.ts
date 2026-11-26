/**
 * @file Conformance checks for RendererService implementations.
 *
 * `runConformanceTests` is synchronous and does not call mount or unmount.
 * `runSurfaceConformance` extends it and does call mount, unmount, resize, and renderViews.
 */

import { GwenError } from "@gwenjs/schema";
import { RendererErrorCodes } from "../errors.js";
import { RENDERER_CONTRACT_VERSION } from "../types.js";
import type { RendererService, RenderView, SurfaceRendererService } from "../types.js";
import { thrownText } from "./thrown-text.js";

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

/** Options of {@link runSurfaceConformance}. */
export interface SurfaceConformanceOptions {
  /** Device pixel ratio passed to `resize()`. A positive finite number. Default `2`. */
  readonly dpr?: number;
}

const DEFAULT_CONFORMANCE_DPR = 2;

function surfaceFailure(what: string, cause?: unknown): GwenError {
  return new GwenError(RendererErrorCodes.CONFORMANCE_FAILED, what, {
    composable: "runSurfaceConformance",
    ...(cause === undefined ? {} : { cause }),
  });
}

/**
 * Surface-renderer checks on top of {@link runConformanceTests}.
 * Confirms kind, one world layer, canvas ownership, dpr on resize, re-entry
 * (mount, unmount, mount, unmount gives a new canvas), a second `unmount()`, and
 * `renderViews` for 0, 1, and 2 views after unmount, which must leave no canvas connected.
 * It needs a DOM (`document`) and no engine.
 *
 * @param service - Surface renderer under test.
 * @param options - `dpr` (default `2`) passed to `resize()`.
 * @throws {GwenError} `RENDERER:CONFORMANCE_FAILED` on the first violation.
 */
export function runSurfaceConformance(
  service: SurfaceRendererService,
  options: SurfaceConformanceOptions = {},
): void {
  runConformanceTests(service);
  if (service.kind !== "surface") {
    throw surfaceFailure(`"${service.name}" kind is ${String(service.kind)}, expected "surface".`);
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
    throw surfaceFailure(`"${service.name}" declares no layer.`);
  }
  const layer = service.layers[layerName];
  if (layer === undefined || layer.coordinate !== "world") {
    throw surfaceFailure(`"${service.name}" layer "${layerName}" must use coordinate "world".`);
  }
  if (typeof service.renderViews !== "function") {
    throw surfaceFailure(`"${service.name}" is missing required method "renderViews".`);
  }

  const dpr = options.dpr ?? DEFAULT_CONFORMANCE_DPR;
  if (!(dpr > 0) || !Number.isFinite(dpr)) {
    throw new GwenError(
      RendererErrorCodes.CONFORMANCE_FAILED,
      `options.dpr is ${dpr}, expected a positive finite number.`,
      {
        composable: "runSurfaceConformance",
        hint: __GWEN_DEV__ ? "Pass a positive dpr, or none for the default of 2." : undefined,
      },
    );
  }

  const canvases: HTMLCanvasElement[] = [];
  const container = document.createElement("div");
  document.body.appendChild(container);
  let mounted = false;
  const markMounted = (): void => {
    mounted = true;
  };
  try {
    const first = mountAndSize(service, layerName, container, dpr, "mount()", markMounted);
    canvases.push(first);
    service.unmount();
    mounted = false;
    if (first.isConnected) {
      throw surfaceFailure(`"${service.name}" left its canvas attached after unmount().`);
    }
    try {
      service.unmount();
    } catch (cause) {
      throw surfaceFailure(
        `"${service.name}" unmount() threw when called twice: ${thrownText(cause)}.`,
        cause,
      );
    }
    const second = mountAndSize(
      service,
      layerName,
      container,
      dpr,
      "mount() after unmount()",
      markMounted,
    );
    canvases.push(second);
    if (second === first) {
      throw surfaceFailure(
        `"${service.name}" mounted the same canvas again, expected a new canvas on every mount().`,
      );
    }
    if (first.isConnected) {
      throw surfaceFailure(
        `"${service.name}" left the first canvas connected after the second mount().`,
      );
    }
    service.unmount();
    mounted = false;
    if (second.isConnected || first.isConnected) {
      throw surfaceFailure(`"${service.name}" left a canvas attached after the second unmount().`);
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
      throw surfaceFailure(
        `"${service.name}" renderViews with ${n} views threw: ${thrownText(cause)}.`,
        cause,
      );
    }
    if (canvases.some((canvas) => canvas.isConnected)) {
      throw surfaceFailure(
        `"${service.name}" renderViews with ${n} views connected a canvas after unmount().`,
      );
    }
  }
}

/** One `mount()`, then the canvas checks and `resize(320, 180, dpr)`. Returns the canvas. */
function mountAndSize(
  service: SurfaceRendererService,
  layerName: string,
  container: HTMLElement,
  dpr: number,
  step: string,
  markMounted: () => void,
): HTMLCanvasElement {
  const cssW = 320;
  const cssH = 180;
  try {
    service.mount(container);
  } catch (cause) {
    if (step === "mount()") throw cause;
    throw surfaceFailure(
      `"${service.name}" ${step} threw, so it cannot mount again: ${thrownText(cause)}.`,
      cause,
    );
  }
  markMounted();
  const canvas = service.getLayerElement(layerName);
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw surfaceFailure(
      `"${service.name}" getLayerElement("${layerName}") must return an HTMLCanvasElement.`,
    );
  }
  if (!canvas.isConnected) {
    throw surfaceFailure(`"${service.name}" did not attach its canvas during ${step}.`);
  }
  service.resize(cssW, cssH, dpr);
  const sized = service.getLayerElement(layerName);
  if (!(sized instanceof HTMLCanvasElement)) {
    throw surfaceFailure(
      `"${service.name}" getLayerElement("${layerName}") must return an HTMLCanvasElement.`,
    );
  }
  const expectW = Math.round(cssW * dpr);
  const expectH = Math.round(cssH * dpr);
  if (sized.width !== expectW || sized.height !== expectH) {
    throw surfaceFailure(
      `"${service.name}" resize(${cssW}, ${cssH}, ${dpr}) left the canvas at ${sized.width}×${sized.height}, expected ${expectW}×${expectH} (dpr ${dpr}).`,
    );
  }
  return canvas;
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

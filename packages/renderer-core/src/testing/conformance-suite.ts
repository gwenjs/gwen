/**
 * @file Conformance checks for RendererService implementations.
 *
 * These checks are intentionally synchronous and side-effect free (they do not
 * call mount/unmount). They validate the static shape of the service object.
 */

import { RENDERER_CONTRACT_VERSION } from "../types.js";
import type { RendererService } from "../types.js";

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

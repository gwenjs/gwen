/**
 * @file Camera provider phase check.
 *
 * A camera provider writes `CameraStateStore` state no later than `engine:after-update`.
 * Renderers read it in `engine:render`.
 */

import type { GwenEngine } from "@gwenjs/core";
import { GwenError, type CameraState } from "@gwenjs/schema";
import { RendererErrorCodes } from "../errors.js";

/** Options for {@link runCameraProviderConformance}. */
export interface CameraProviderConformanceOptions {
  /** Viewport whose camera state is read. */
  readonly viewportId: string;
  /** Frame step in seconds. Defaults to `1 / 60`. */
  readonly dt?: number;
}

/**
 * Advance one frame and reject when `viewportId` has no camera state after
 * `engine:after-update`, or when that state is gone in `engine:render`.
 *
 * Run it on an engine that is not started, or pass a `dt` of at least one fixed step.
 *
 * @param engine - Engine whose `cameraManager` the provider writes.
 * @param options - Viewport to read, and an optional frame step.
 * @throws {GwenError} `RENDERER:CONFORMANCE_FAILED` on the first violation.
 */
export async function runCameraProviderConformance(
  engine: GwenEngine,
  options: CameraProviderConformanceOptions,
): Promise<void> {
  const cameras = engine.tryInject("cameraManager");
  if (cameras === undefined) {
    fail(
      'No "cameraManager" service is installed.',
      "Install the viewport host before the camera provider.",
    );
  }
  cameras.clearFrame();
  let afterUpdate: CameraState | undefined;
  let render: CameraState | undefined;
  // Registered last, so these probes run after the provider's own handlers.
  const offAfterUpdate = engine.hooks.hook("engine:after-update", () => {
    afterUpdate = cameras.get(options.viewportId);
  });
  const offRender = engine.hooks.hook("engine:render", () => {
    render = cameras.get(options.viewportId);
  });
  try {
    await engine.advance(options.dt ?? 1 / 60);
  } finally {
    offAfterUpdate();
    offRender();
  }
  if (afterUpdate === undefined) {
    const later = render !== undefined ? " The provider wrote it later, in engine:render." : "";
    fail(
      `No camera state for "${options.viewportId}" after engine:after-update.${later}`,
      "Write the camera state in engine:after-update.",
    );
  }
  if (render === undefined) {
    fail(
      `The camera state for "${options.viewportId}" was gone in engine:render.`,
      "Keep the camera state until engine:render has read it.",
    );
  }
}

function fail(what: string, hint: string): never {
  throw new GwenError(RendererErrorCodes.CONFORMANCE_FAILED, what, {
    composable: "runCameraProviderConformance",
    hint: __GWEN_DEV__ ? hint : undefined,
  });
}

// packages/camera-core/src/camera-core-plugin.ts
/**
 * @file CameraCorePlugin — registers CameraSystem and the orthographic bounds provider.
 *
 * The viewport and camera services come from `gwen:viewports`.
 * The orthographic bounds provider is registered when `gwen:screen` is installed before it.
 * This plugin reads those services. It does not provide them.
 * Called automatically by Camera2DPlugin and Camera3DPlugin.
 * Users do not install this plugin manually unless building a custom camera composable.
 *
 * @example
 * ```ts
 * // Only if building a custom camera — normally not needed.
 * // gwen:viewports must already be installed.
 * // The bounds provider is registered when gwen:screen is installed before it.
 * await engine.use(CameraCorePlugin())
 * ```
 */

import { definePlugin } from "@gwenjs/kit/plugin";
import type { GwenEngine } from "@gwenjs/core";
import type { CameraManager, ViewportBoundsProvider } from "@gwenjs/renderer-core";
import { CameraSystem } from "./camera-system.js";

/**
 * Orthographic bounds provider — computes axis-aligned world-space bounds
 * for orthographic cameras. CameraCorePlugin registers it when `gwen:screen` is installed before it.
 * Returns undefined for perspective cameras or inactive cameras.
 *
 * @internal Exported for testing; prefer `CameraCorePlugin` for production use.
 */
export function createOrthoBoundsProvider(cameraManager: CameraManager): ViewportBoundsProvider {
  return {
    compute(viewportId: string, pixelWidth: number, pixelHeight: number) {
      const cam = cameraManager.get(viewportId);
      if (!cam?.active) return undefined;
      if (cam.projection.type !== "orthographic") return undefined;

      const { zoom } = cam.projection;
      const worldW = pixelWidth / zoom;
      const worldH = pixelHeight / zoom;
      const cx = cam.worldTransform.position.x;
      const cy = cam.worldTransform.position.y;

      return {
        minX: cx - worldW / 2,
        maxX: cx + worldW / 2,
        minY: cy - worldH / 2,
        maxY: cy + worldH / 2,
      };
    },
  };
}

export const CameraCorePlugin = definePlugin(() => ({
  name: "camera-core",
  requires: {
    services: ["cameraManager", "viewportManager"],
    // screenService stays optional so unuse("gwen:screen") is legal while this plugin remains.
    optional: ["screenService"],
  },
  async setup(engine: GwenEngine) {
    const cameras = engine.inject("cameraManager");
    const screen = engine.tryInject("screenService");
    // External camera plugins may replace this provider from their own setup.
    if (screen !== undefined) {
      screen.registerBoundsProvider(createOrthoBoundsProvider(cameras));
    }

    await engine.use(CameraSystem());
  },
}));

// packages/camera-core/src/camera-core-plugin.ts
/**
 * @file CameraCorePlugin — installs CameraManager, ViewportManager, CameraSystem,
 * and registers the orthographic bounds provider with ScreenService.
 *
 * Called automatically by Camera2DPlugin and Camera3DPlugin.
 * Users do not install this plugin manually unless building a custom camera composable.
 *
 * @example
 * ```ts
 * // Only if building a custom camera — normally not needed
 * await engine.use(CameraCorePlugin())
 * ```
 */

import { definePlugin } from "@gwenjs/kit/plugin";
import {
  getOrCreateCameraManager,
  getOrCreateViewportManager,
  getOrCreateScreenService,
} from "@gwenjs/renderer-core";
import type { ViewportBoundsProvider } from "@gwenjs/renderer-core";
import { CameraSystem } from "./camera-system.js";

/**
 * Orthographic bounds provider — computes axis-aligned world-space bounds
 * for orthographic cameras. Registered automatically by CameraCorePlugin.
 * Returns undefined for perspective cameras or inactive cameras.
 *
 * @internal Exported for testing; prefer `CameraCorePlugin` for production use.
 */
export function createOrthoBoundsProvider(
  cameraManager: ReturnType<typeof getOrCreateCameraManager>,
): ViewportBoundsProvider {
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
  async setup(engine) {
    const cameras = getOrCreateCameraManager(engine);
    getOrCreateViewportManager(engine);

    // Register the orthographic bounds provider with ScreenService.
    // External camera plugins (camera2d, camera3d) may override this by calling
    // getOrCreateScreenService(engine).registerBoundsProvider() in their own setup.
    getOrCreateScreenService(engine).registerBoundsProvider(createOrthoBoundsProvider(cameras));

    await engine.use(CameraSystem());
  },
}));

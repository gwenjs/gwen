// packages/camera-core/src/camera-core-plugin.ts
/**
 * @file CameraCorePlugin — installs CameraManager, ViewportManager, and CameraSystem.
 *
 * Called automatically by Camera2DPlugin and Camera3DPlugin.
 * Users do not install this plugin manually unless they are building a custom
 * camera composable from scratch.
 *
 * @example
 * ```ts
 * // Only if building a custom camera — normally not needed
 * await engine.use(CameraCorePlugin())
 * ```
 */

import { definePlugin } from "@gwenjs/kit/plugin";
import { getOrCreateCameraManager, getOrCreateViewportManager } from "@gwenjs/renderer-core";
import { CameraSystem } from "./camera-system.js";

export const CameraCorePlugin = definePlugin(() => ({
  name: "camera-core",
  setup(engine) {
    getOrCreateCameraManager(engine);
    getOrCreateViewportManager(engine);
    void engine.use(CameraSystem);
  },
}));

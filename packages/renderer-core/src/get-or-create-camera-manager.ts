// packages/renderer-core/src/get-or-create-camera-manager.ts
/**
 * @file getOrCreateCameraManager — lazy singleton factory.
 *
 * Plugin setup code calls this instead of `new CameraManagerImpl()`.
 * Returns the same instance for all plugins sharing an engine.
 *
 * @example
 * ```ts
 * setup(engine) {
 *   const cameras = getOrCreateCameraManager(engine)
 * }
 * ```
 */

import type { GwenEngine } from "@gwenjs/core";
import { CameraManagerImpl } from "./camera-manager.js";
import type { CameraManager } from "./camera-manager.js";

declare module "@gwenjs/core" {
  interface GwenProvides {
    cameraManager: CameraManager;
  }
}

/**
 * Return the shared {@link CameraManager} for this engine instance, creating it
 * if it does not yet exist.
 */
export function getOrCreateCameraManager(engine: GwenEngine): CameraManager {
  const existing = engine.tryInject("cameraManager");
  if (existing) return existing;

  const manager = new CameraManagerImpl();
  engine.provide("cameraManager", manager);
  return manager;
}

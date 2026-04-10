// packages/renderer-core/src/use-camera-manager.ts
/**
 * @file useCameraManager — composable accessor for CameraManager.
 *
 * Use inside `defineSystem`, `defineActor`, or `defineScene` setup functions.
 * Requires CameraCorePlugin (from @gwenjs/camera-core) to have been installed.
 *
 * @example
 * ```ts
 * const cameras = useCameraManager()
 * onRender(() => {
 *   const state = cameras.get('main')
 * })
 * ```
 */

import { useService } from "@gwenjs/core/system";
import type { CameraManager } from "./camera-manager.js";

/** Resolve the shared {@link CameraManager} from the current engine context. */
export function useCameraManager(): CameraManager {
  return useService("cameraManager");
}

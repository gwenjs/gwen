// packages/renderer-core/src/use-camera-manager.ts
/**
 * @file useCameraManager — composable accessor for CameraManager.
 *
 * Use inside `defineSystem`, `defineActor`, or `defineScene` setup functions.
 * Provided by `gwen:viewports`. Declare `cameraManager` in `requires.services`
 * or `requires.optional` on a plugin that reads it during setup.
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

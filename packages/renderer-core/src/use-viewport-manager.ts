// packages/renderer-core/src/use-viewport-manager.ts
/**
 * @file useViewportManager — composable accessor for ViewportManager.
 *
 * Use inside `defineSystem`, `defineActor`, or `defineScene` setup functions.
 * Requires CameraCorePlugin (from @gwenjs/camera-core) to have been installed.
 *
 * @example
 * ```ts
 * const viewports = useViewportManager()
 * onEvent('player2:joined', () => {
 *   viewports.set('p1', { x: 0, y: 0, width: 0.5, height: 1 })
 * })
 * ```
 */

import { useService } from "@gwenjs/core/system";
import type { ViewportManager } from "./viewport-manager.js";

/** Resolve the shared {@link ViewportManager} from the current engine context. */
export function useViewportManager(): ViewportManager {
  return useService("viewportManager");
}

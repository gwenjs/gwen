/**
 * @file useScreen — composable accessor for per-viewport screen information.
 *
 * Use inside `defineSystem`, `defineActor`, or `defineScene` setup functions.
 * The returned object is stable — mutated in place, never recreated.
 * It is safe to capture in closures and async callbacks.
 *
 * Requires `ScreenPlugin` to be installed (registered automatically by `@gwenjs/app`).
 *
 * @example Player clamping (system)
 * ```ts
 * const MovementSystem = defineSystem('MovementSystem', () => {
 *   const screen = useScreen('main')
 *
 *   onUpdate(() => {
 *     for (const id of players) {
 *       if (screen.bounds) {
 *         Position.x[id] = Math.max(screen.bounds.minX, Math.min(screen.bounds.maxX, Position.x[id]))
 *         Position.y[id] = Math.max(screen.bounds.minY, Math.min(screen.bounds.maxY, Position.y[id]))
 *       }
 *     }
 *   })
 * })
 * ```
 *
 * @example Actor with async lifecycle (capture pattern)
 * ```ts
 * const PlayerActor = defineActor(PlayerPrefab, () => {
 *   const screen = useScreen('main') // captured in sync setup
 *
 *   onStart(async () => {
 *     await loadAssets()
 *     Position.x[id] = screen.pixels.width / 2  // safe — stable reference
 *   })
 * })
 * ```
 *
 * @example Scene
 * ```ts
 * const GameScene = defineScene('game', () => {
 *   const screen = useScreen()
 *
 *   onEnter(() => {
 *     console.log(`Viewport: ${screen.pixels.width}×${screen.pixels.height}`)
 *   })
 * })
 * ```
 */

import { useService } from "@gwenjs/core/system";
import type { ViewportScreenInfo } from "./screen-service.js";

/**
 * Returns the stable {@link ViewportScreenInfo} for the given viewport.
 *
 * Must be called during a synchronous setup phase:
 * `defineSystem()`, `defineActor()`, or `defineScene()` factory.
 * The returned reference is safe to use in any callback or async context.
 *
 * @param viewportId - The viewport to observe. Defaults to `'main'`.
 * @returns A stable object with `pixels`, `dpr`, and `bounds` (mutated each frame).
 */
export function useScreen(viewportId = "main"): ViewportScreenInfo {
  const service = useService("screenService");
  return service.getOrCreateInfo(viewportId);
}

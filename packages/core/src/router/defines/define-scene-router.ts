/**
 * @file `defineSceneRouter()` — FSM scene router factory.
 *
 * Declares the set of scenes (states) and their valid transitions.
 * The resulting `SceneRouterDefinition` is consumed by `useSceneRouter()`.
 *
 * @example
 * ```typescript
 * export const AppRouter = defineSceneRouter({
 *   initial: 'menu',
 *   routes: {
 *     menu: { scene: MenuScene, on: { PLAY: 'game' } },
 *     game: { scene: GameScene, on: { PAUSE: 'pause', DIE: 'gameover' } },
 *     pause: { scene: PauseScene, overlay: true, on: { RESUME: 'game', QUIT: 'menu' } },
 *     gameover: { scene: GameOverScene, on: { RETRY: 'game', MENU: 'menu' } },
 *   },
 * })
 * ```
 */

import type { RouteConfig, SceneRouterOptions, SceneRouterDefinition } from "../router-types";
import { GwenSceneRouterError } from "../../engine/engine-errors";

/** True when `value` is one of the route `keys`. A number or a symbol is never a route name. */
function isRouteKey(keys: readonly string[], value: unknown): value is string {
  return typeof value === "string" && keys.includes(value);
}

/**
 * Declares a type-safe FSM scene router.
 *
 * Validates that:
 * - `initial` is a key in `routes`
 * - All transition targets are keys in `routes`
 *
 * @param options - Router configuration with routes and initial state.
 * @returns An opaque `SceneRouterDefinition` to pass to `useSceneRouter()`.
 *
 * @throws {GwenSceneRouterError} If `initial` is not a valid route key.
 * @throws {GwenSceneRouterError} If any transition target is not a valid route key.
 *
 * @example
 * ```typescript
 * const router = defineSceneRouter({
 *   initial: 'menu',
 *   routes: {
 *     menu: { scene: MenuScene, on: { PLAY: 'game' } },
 *     game: { scene: GameScene, on: { PAUSE: 'pause' } },
 *   },
 * });
 * ```
 */
export function defineSceneRouter<TRoutes extends Record<string, RouteConfig<TRoutes>>>(
  options: SceneRouterOptions<TRoutes>,
): SceneRouterDefinition<TRoutes> {
  const keys = Object.keys(options.routes);

  if (!isRouteKey(keys, options.initial)) {
    throw new GwenSceneRouterError(
      `Initial state "${String(options.initial)}" is not found in routes.`,
      String(options.initial),
      keys,
    );
  }

  for (const [state, config] of Object.entries(options.routes)) {
    if (config.on) {
      for (const [event, target] of Object.entries(config.on)) {
        if (!isRouteKey(keys, target)) {
          throw new GwenSceneRouterError(
            `Transition "${event}" in state "${state}" points to "${String(target)}", which is not a valid route.`,
            String(target),
            keys,
            state,
            event,
          );
        }
      }
    }
  }

  return {
    __type: "SceneRouterDefinition",
    options,
  };
}

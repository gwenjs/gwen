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

import type { RouteConfig, SceneRouterOptions, SceneRouterDefinition } from './router-types.js';

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
 * @throws If `initial` is not a valid route key.
 * @throws If any transition target is not a valid route key.
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

  if (!keys.includes(options.initial as string)) {
    throw new Error(
      `[GWEN] defineSceneRouter: initial state "${String(options.initial)}" not found in routes. ` +
        `Valid states: ${keys.join(', ')}`,
    );
  }

  for (const [state, config] of Object.entries(options.routes) as [
    string,
    RouteConfig<TRoutes>,
  ][]) {
    if (config.on) {
      for (const [event, target] of Object.entries(config.on)) {
        if (!keys.includes(target as string)) {
          throw new Error(
            `[GWEN] defineSceneRouter: transition "${event}" in state "${state}" points to ` +
              `"${String(target)}" which is not a valid route. Valid states: ${keys.join(', ')}`,
          );
        }
      }
    }
  }

  return {
    __type: 'SceneRouterDefinition',
    options,
  } as SceneRouterDefinition<TRoutes>;
}

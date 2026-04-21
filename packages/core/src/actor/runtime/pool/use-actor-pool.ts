/**
 * Scene composable that installs a pool into the current scene and returns it
 * as the canonical handle for the rest of the scene's lifetime.
 *
 * Registers both the underlying actor plugin and the pool plugin via the
 * `scene:registrar` service so that `pool.acquire()` works as soon as `onEnter`
 * fires. `pool.destroyAll()` is called automatically when the scene emits
 * `scene:beforeLeave`.
 *
 * Must be called synchronously inside a `defineScene()` factory function.
 * Pools must **only** be used through the handle returned by this composable —
 * never by importing the `defineActorPool` value directly.
 *
 * @param pool - The pool returned by `defineActorPool()`.
 * @returns The same pool, ready to be passed to systems or actors via props.
 *
 * @throws {GwenContextError} If called outside an active engine context.
 *
 * @example
 * ```ts
 * export const GameScene = defineScene('game', () => {
 *   const enemyPool = useActorPool(EnemyPool);
 *   useSystem(SpawnSystem(enemyPool));
 * });
 * ```
 */
import { useEngine } from "../../../engine/context";
import { SCENE_REGISTRAR_KEY } from "../../../scene/runtime/scene-registrar";
import { GwenScope } from "../../../context/scope.js";
import type { ActorPool } from "./types";

export function useActorPool<Props, PublicAPI>(
  pool: ActorPool<Props, PublicAPI>,
): ActorPool<Props, PublicAPI> {
  const engine = useEngine();

  // Register actor and pool plugins with the active scene.
  const registrar = engine.inject(SCENE_REGISTRAR_KEY);
  registrar.register(pool._actorPlugin);
  registrar.register(pool._plugin);

  // Auto-destroy pool when the scene leaves.
  // Use the active scope (the scene's GwenScope) to register the cleanup hook.
  const scope = GwenScope.current();
  if (scope) {
    scope.hook("scene:beforeLeave", () => {
      pool.destroyAll();
    });
  } else {
    // Fallback: should not happen inside a defineScene() factory, but guard defensively.
    engine.hooks.hook("scene:beforeLeave", () => {
      pool.destroyAll();
    });
  }

  return pool;
}

import { onExit, _registerScenePlugin } from "../../scene/scene-context";
import type { ActorPool } from "./types";

/**
 * Scene composable that installs a pool into the current scene and returns it
 * as the canonical handle for the rest of the scene's lifetime.
 *
 * Registers both the underlying actor plugin and the pool plugin in the
 * correct order so that `pool.acquire()` works as soon as `onEnter` fires.
 * `pool.destroyAll()` is called automatically when the scene exits.
 *
 * Must be called synchronously inside a `defineScene()` factory function.
 * Pools must **only** be used through the handle returned by this composable —
 * never by importing the `defineActorPool` value directly.
 *
 * @param pool - The pool returned by `defineActorPool()`.
 * @returns The same pool, ready to be passed to systems or actors via props.
 *
 * @example
 * ```ts
 * export const GameScene = defineScene('game', () => {
 *   const enemyPool = useActorPool(EnemyPool)
 *   useSystem(SpawnSystem(enemyPool))
 *   // EnemyPool.destroyAll() is called automatically on scene exit.
 * })
 * ```
 */
export function useActorPool<Props, PublicAPI>(
  pool: ActorPool<Props, PublicAPI>,
): ActorPool<Props, PublicAPI> {
  // Actor plugin must be installed before the pool plugin so that
  // pool.acquire() can call actor._plugin.spawn() on first use.
  _registerScenePlugin(pool._actorPlugin);
  _registerScenePlugin(pool._plugin);

  // onExit() throws "[GWEN]..." if called outside a scene context — we rely on
  // that error to propagate naturally for the "outside factory" guard.
  onExit(() => {
    pool.destroyAll();
  });

  return pool;
}

import { onExit } from "../../scene/scene-context";
import type { ActorPool } from "./types";

/**
 * Scene composable that binds a pool's lifetime to the current scene.
 * `pool.destroyAll()` is called automatically when the scene exits.
 *
 * Must be called synchronously inside a `defineScene()` factory function.
 *
 * @param pool - The pool returned by `defineActorPool()`.
 *
 * @example
 * ```ts
 * export const GameScene = defineScene('game', () => {
 *   useActorPool(EnemyPool)
 *   // EnemyPool.destroyAll() is called automatically on scene exit.
 * })
 * ```
 */
export function useActorPool<Props, PublicAPI>(pool: ActorPool<Props, PublicAPI>): void {
  // onExit() throws "[GWEN]..." if called outside a scene context — we rely on
  // that error to propagate naturally for the "outside factory" guard.
  onExit(() => {
    pool.destroyAll();
  });
}

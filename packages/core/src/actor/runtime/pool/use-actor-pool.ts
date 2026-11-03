/**
 * Composable that returns the handle of a pool definition: the object that
 * acquires, releases and reports stats.
 *
 * It works in any engine context: `defineScene()`, `defineSystem()`,
 * `defineActor()`, `definePlugin()` setup, or `engine.run()`. Inside a scene
 * factory (the active scope is a scene scope) it also registers the underlying
 * actor plugin and the pool plugin via the `scene:registrar` service, so that
 * `pool.acquire()` works as soon as `onEnter` fires, and `pool.destroyAll()` is
 * called when the scene emits `scene:beforeLeave`. In any other context it
 * registers nothing, even after a scene factory has run on the same engine.
 *
 * Pools must **only** be used through the handle returned by this composable —
 * the `defineActorPool` value has no `acquire()`.
 *
 * @param definition - The value returned by `defineActorPool()`.
 * @returns The pool handle, ready to be passed to systems or actors via props.
 *
 * @throws {GwenContextError} `CORE:OUTSIDE_ENGINE_CONTEXT` naming `useActorPool`
 *   when no engine is current.
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
import { GwenScope } from "../../../context/scope.js";
import { actorPluginOf } from "./define-actor-pool";
import type { ActorPool, ActorPoolDefinition } from "./types";

export function useActorPool<Props, PublicAPI>(
  definition: ActorPoolDefinition<Props, PublicAPI>,
): ActorPool<Props, PublicAPI> {
  const engine = useEngine("useActorPool");

  // `scene:registrar` stays provided on the engine after a scene factory ran,
  // so only an active scene scope means "inside a scene factory".
  const registrar = engine.tryInject("scene:registrar");
  const scope = GwenScope.current();
  if (registrar !== undefined && scope?.meta.type === "scene") {
    // Register actor and pool plugins with the active scene.
    registrar.register(actorPluginOf(definition));
    registrar.register(definition.plugin);

    // Auto-destroy pool when the scene leaves.
    scope.hook("scene:beforeLeave", () => {
      definition._pool.destroyAll();
    });
  }

  return definition._pool;
}

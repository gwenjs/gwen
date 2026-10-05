import type { ActorDefinition } from "./types";
import type { EntityId } from "../../engine/engine-api";

/**
 * Returns a lazy iterable over the public APIs of actor instances whose
 * underlying entity currently matches the provided query.
 *
 * The iterable is re-evaluated on every `for...of` loop — it reflects the
 * live ECS state at iteration time, not at the time `useActorQuery` was called.
 * No intermediate array is allocated.
 *
 * Pair with {@link useQuery} to build the query:
 * ```ts
 * defineSystem(() => {
 *   const inRange = useQuery([InRangeTag])
 *   const nearby = useActorQuery(EnemyActor, inRange)
 *
 *   onUpdate(() => {
 *     for (const enemy of nearby) {
 *       enemy.takeDamage(10)
 *     }
 *   })
 * })
 * ```
 *
 * @param def - The actor definition produced by {@link defineActor}.
 * @param query - Any iterable of objects exposing a numeric `id` field —
 *   typically the {@link LiveQuery} returned by {@link useQuery}.
 * @returns A lazy `Iterable<PublicAPI>` filtered to instances present in the query.
 */
export function useActorQuery<P, A>(
  def: ActorDefinition<P, A>,
  query: Iterable<{ readonly id: EntityId }>,
): Iterable<A> {
  return {
    [Symbol.iterator](): Iterator<A> {
      return (function* () {
        for (const entry of query) {
          const instance = def._instances.get(entry.id);
          if (instance !== undefined && instance.api !== undefined) yield instance.api;
        }
      })();
    },
  };
}

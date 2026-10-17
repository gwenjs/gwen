import type { ActorDefinition } from "./types";
import type { EntityId } from "../../engine/engine-api";
import type { GwenEngine } from "../../engine/engine-types";
import type { Query } from "../../engine/chunk-query";
import {
  popPerEntitySuppress,
  pushPerEntitySuppress,
  readQueryEngine,
} from "../../engine/engine-internals";
import type { ComponentDef } from "../../system/runtime/define-system";

/**
 * Returns a lazy iterable of the public APIs of actor instances whose entity
 * is in `query` at iteration time.
 *
 * Each `for...of` reads the query again. Pass a {@link Query} from `useQuery`,
 * or any iterable of `{ id }`. A `Query` is read with `each()` for that walk
 * only. That read does not emit the per-entity warning.
 *
 * @param def - The actor definition produced by {@link defineActor}.
 * @param query - A chunk {@link Query}, or an iterable of objects with an `id`.
 * @returns A lazy iterable of the public APIs. Entities with no live instance are skipped.
 *
 * @example
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
 */
export function useActorQuery<
  P,
  A,
  const C extends readonly ComponentDef[] = readonly ComponentDef[],
>(def: ActorDefinition<P, A>, query: Query<C> | Iterable<{ readonly id: EntityId }>): Iterable<A> {
  return {
    [Symbol.iterator](): Iterator<A> {
      return (function* (): Generator<A> {
        if (isRegisteredQuery(query)) {
          const engine = readQueryEngine(query);
          if (engine !== undefined) {
            for (const entry of suppressedEach(query, engine)) {
              const instance = def._instances.get(entry.id);
              if (instance !== undefined) yield instance.api!;
            }
          }
          return;
        }
        for (const entry of query) {
          const instance = def._instances.get(entry.id);
          if (instance !== undefined) yield instance.api!;
        }
      })();
    },
  };
}

function isRegisteredQuery<const C extends readonly ComponentDef[]>(
  query: Query<C> | Iterable<{ readonly id: EntityId }>,
): query is Query<C> {
  return typeof query === "object" && query !== null && readQueryEngine(query) !== undefined;
}

/** `each()` warns on entry. Suppress only that call, then walk the live query. */
function suppressedEach<const C extends readonly ComponentDef[]>(
  query: Query<C>,
  engine: GwenEngine,
): ReturnType<Query<C>["each"]> {
  pushPerEntitySuppress(engine);
  try {
    return query.each();
  } finally {
    popPerEntitySuppress(engine);
  }
}

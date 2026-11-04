import type { ActorInstance } from "./types";

/**
 * Reads the public API of an actor instance.
 *
 * `ActorInstance.api` is `undefined` until the factory has returned, and stays `undefined` for
 * a factory that returns nothing. The public handle types call that case `void`. This is the
 * one place that narrows it, so callers keep the same value they read before.
 *
 * @param instance - Instance to read, or `undefined` when the entity has no instance here.
 * @returns The stored API, or `undefined` typed as `API`.
 * @internal
 */
export function instanceApi<API>(instance: ActorInstance<API> | undefined): API {
  return instance?.api as API; // boundary: the result is undefined when the entity has no instance here, before the factory returns, and when it returns nothing, while the handle types promise API in each case
}

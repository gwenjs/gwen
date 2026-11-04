import type { GwenEngine } from "../../engine/engine-types";
import type { RouteConfig, SceneRouterDefinition, SceneRouterHandle } from "../router-types";

// Module-level WeakMap keyed by engine instance — avoids monkey-patching the engine object.
// WeakMap allows the map entry (and the inner Map) to be GC'd when the engine is destroyed.
// Each value is the handle built for the definition used as its key.
const handlesByEngine = new WeakMap<GwenEngine, Map<unknown, unknown>>();

/**
 * Returns the handle already built for `routerDef` on `engine`, if any.
 *
 * @param engine - Engine the handle belongs to.
 * @param routerDef - Definition the handle was built from.
 * @returns The cached handle, or `undefined` before the first `setCachedRouter`.
 */
export function getCachedRouter<TRoutes extends Record<string, RouteConfig<TRoutes>>>(
  engine: GwenEngine,
  routerDef: SceneRouterDefinition<TRoutes>,
): SceneRouterHandle<TRoutes> | undefined {
  return handlesByEngine.get(engine)?.get(routerDef) as SceneRouterHandle<TRoutes> | undefined; // boundary: the cache stores handles of every router under one value type, and the definition key is the one that built the handle of its own TRoutes
}

/**
 * Stores the handle built for `routerDef` on `engine`.
 *
 * @param engine - Engine the handle belongs to.
 * @param routerDef - Definition the handle was built from.
 * @param handle - The handle to return on later calls.
 */
export function setCachedRouter<TRoutes extends Record<string, RouteConfig<TRoutes>>>(
  engine: GwenEngine,
  routerDef: SceneRouterDefinition<TRoutes>,
  handle: SceneRouterHandle<TRoutes>,
): void {
  let handles = handlesByEngine.get(engine);
  if (handles === undefined) {
    handles = new Map<unknown, unknown>();
    handlesByEngine.set(engine, handles);
  }
  handles.set(routerDef, handle);
}

/**
 * Drops the handle built for `routerDef` on `engine`.
 *
 * @param engine - Engine the handle belongs to.
 * @param routerDef - Definition the handle was built from.
 */
export function deleteCachedRouter(engine: GwenEngine, routerDef: unknown): void {
  handlesByEngine.get(engine)?.delete(routerDef);
}

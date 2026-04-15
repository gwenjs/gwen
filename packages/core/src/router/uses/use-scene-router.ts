/**
 * @file `useSceneRouter()` — runtime FSM scene router composable.
 *
 * Manages scene transitions, lifecycle hooks (onEnter/onExit),
 * overlay stacking (pause menus), and the params channel between scenes.
 *
 * Must be called inside an active engine context.
 *
 * @example
 * ```typescript
 * const PlayerActor = defineActor(PlayerPrefab, () => {
 *   const nav = useSceneRouter(AppRouter)
 *   const health = useComponent(Health)
 *   onUpdate(() => {
 *     if (health.value <= 0) nav.send('DIE')
 *   })
 *   return {}
 * })
 * ```
 */

import { useEngine, engineContext } from "../../engine/context";
import type { GwenEngine } from "../../engine/gwen-engine";
import type {
  RouteConfig,
  SceneRouterDefinition,
  SceneRouterHandle,
  EventsOf,
  StatesOf,
} from "../router-types";
import type { SceneDefinition, SceneFactory } from "../../scene/runtime/define-scene";

// Module-level WeakMap keyed by engine instance — avoids monkey-patching the engine object.
// WeakMap allows the map entry (and the inner Map) to be GC'd when the engine is destroyed.
const routerCacheByEngine = new WeakMap<GwenEngine, Map<unknown, SceneRouterHandle<any>>>();

type TransitionListener<TRoutes extends Record<string, RouteConfig<TRoutes>>> = (
  from: StatesOf<TRoutes>,
  to: StatesOf<TRoutes>,
  params: Record<string, unknown>,
) => void;

function resolveScene(input: SceneDefinition | SceneFactory): SceneDefinition {
  if (typeof input === "function") {
    return (input as SceneFactory)({ register: () => {} });
  }
  return input as SceneDefinition;
}

/**
 * Returns a `SceneRouterHandle` bound to the current engine instance.
 *
 * Singleton per engine + router pair — subsequent calls return the same handle.
 *
 * @param routerDef - Created by `defineSceneRouter()`.
 * @returns Runtime handle with `send()`, `can()`, `current`, `params`, `onTransition()`.
 * @throws If called outside an active engine context.
 */
export function useSceneRouter<TRoutes extends Record<string, RouteConfig<TRoutes>>>(
  routerDef: SceneRouterDefinition<TRoutes>,
): SceneRouterHandle<TRoutes> {
  let engine: GwenEngine;
  try {
    engine = useEngine();
  } catch {
    // Rethrow with a useSceneRouter-specific message for test compatibility
    throw new Error(
      "[GWEN] useSceneRouter() must be called inside an active engine context. Call it inside engine.run(), defineActor(), defineSystem(), or scene lifecycle hooks.",
    );
  }

  // Singleton cache per (engine, routerDef) pair — stored in a module-level WeakMap
  // so the engine object itself is never mutated.
  let cache = routerCacheByEngine.get(engine);
  if (!cache) {
    cache = new Map<unknown, SceneRouterHandle<any>>();
    routerCacheByEngine.set(engine, cache);
  }
  if (cache.has(routerDef)) {
    return cache.get(routerDef)! as SceneRouterHandle<TRoutes>;
  }

  const { options } = routerDef;
  const routes = options.routes;

  let currentState = options.initial as StatesOf<TRoutes>;
  let currentParams: Record<string, unknown> = {};
  const overlayStack: StatesOf<TRoutes>[] = [];
  const listeners: TransitionListener<TRoutes>[] = [];

  // Clear listeners and the cache entry when the engine stops so closures captured
  // by onTransition() handlers do not prevent garbage collection.
  engine.hooks.hook("engine:stop", () => {
    listeners.length = 0;
    routerCacheByEngine.get(engine)?.delete(routerDef);
  });

  // Activate initial scene (fire-and-forget with full context scope)
  const initialScene = resolveScene(routes[currentState as keyof TRoutes].scene);
  if (initialScene.onEnter) {
    const _onEnter = initialScene.onEnter;
    (async () => {
      engineContext.set(engine, true);
      try {
        await _onEnter();
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error(e);
      } finally {
        engineContext.unset();
      }
    })();
  }

  const handle: SceneRouterHandle<TRoutes> = {
    get current() {
      return currentState;
    },
    get params() {
      return currentParams;
    },

    can(event: EventsOf<TRoutes>): boolean {
      const route = routes[currentState as keyof TRoutes];
      return !!(route?.on && (event as string) in route.on);
    },

    async send(event: EventsOf<TRoutes>, params: Record<string, unknown> = {}): Promise<void> {
      const route = routes[currentState as keyof TRoutes];
      const target = route?.on?.[event as string] as StatesOf<TRoutes> | undefined;

      if (!target) {
        if (!import.meta.env.PROD) {
          // Silently ignore in production, warn in dev
          // eslint-disable-next-line no-console
          console.warn(
            `[GWEN] useSceneRouter: event "${String(event)}" has no transition in state "${String(currentState)}". Ignoring.`,
          );
        }
        return;
      }

      const fromState = currentState;
      const fromScene = resolveScene(routes[fromState as keyof TRoutes].scene);
      const toConfig = routes[target as keyof TRoutes];
      const toScene = resolveScene(toConfig.scene);

      if (toConfig.overlay) {
        // Push onto overlay stack — do NOT exit current scene
        overlayStack.push(fromState);
      } else if (overlayStack.length > 0 && target === overlayStack[overlayStack.length - 1]) {
        // Popping back to underlying scene — restore without calling onEnter
        overlayStack.pop();
        currentState = target;
        currentParams = params;
        for (const l of listeners) l(fromState, target, params);
        return;
      } else {
        // Normal transition — exit current, clear any overlay stack
        overlayStack.length = 0;
        if (fromScene.onExit) {
          // Keep engine context alive for the full async duration of onExit.
          // engineContext.set() keeps currentInstance set across every await
          // inside onExit without requiring the @gwenjs/vite async transform.
          engineContext.set(engine, true);
          try {
            await fromScene.onExit!();
          } finally {
            engineContext.unset();
          }
        }
      }

      currentState = target;
      currentParams = params;

      if (toScene.onEnter) {
        // Same pattern: keep engine context alive for the full async duration.
        engineContext.set(engine, true);
        try {
          await toScene.onEnter!(params);
        } finally {
          engineContext.unset();
        }
      }

      for (const l of listeners) l(fromState, target, params);
    },

    onTransition(handler: TransitionListener<TRoutes>): () => void {
      listeners.push(handler);
      return () => {
        const idx = listeners.indexOf(handler);
        if (idx !== -1) listeners.splice(idx, 1);
      };
    },
  };

  cache.set(routerDef, handle);
  return handle;
}

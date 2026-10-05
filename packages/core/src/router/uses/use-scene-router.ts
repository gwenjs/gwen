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

import { useEngine } from "../../engine/context";
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

  // Resolve all scene factories eagerly — each factory runs once, registering
  // its onEnter/onExit handlers on engine.hooks. Initial activation is not
  // done here: the generated bootstrap awaits scene:enter before start().
  // Build a route-key → scene-name map so hook emissions use the scene's canonical name.
  const sceneNameByRoute = new Map<string, string>();
  for (const routeKey of Object.keys(routes)) {
    const def = resolveScene(routes[routeKey as keyof TRoutes].scene);
    sceneNameByRoute.set(routeKey, def.name);
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
        engine.logger.warn(
          `useSceneRouter: event "${String(event)}" has no transition in state "${String(currentState)}". Ignoring.`,
        );
        return;
      }

      const fromState = currentState;
      const fromName = sceneNameByRoute.get(String(fromState)) ?? String(fromState);
      const toName = sceneNameByRoute.get(String(target)) ?? String(target);
      const toConfig = routes[target as keyof TRoutes];

      if (toConfig.overlay) {
        // Push onto overlay stack — do NOT exit current scene
        overlayStack.push(fromState);
      } else if (overlayStack.length > 0 && target === overlayStack[overlayStack.length - 1]) {
        // Popping back to underlying scene — run overlay exit lifecycle, skip underlying onEnter.
        // The underlying scene was never paused (scene:beforeLeave was not fired on enter),
        // so we must not fire scene:enter either — it would double-resume its systems.
        await engine.hooks.callHook("scene:transition:leave", { from: fromName, to: toName });
        await engine.hooks.callHook("scene:beforeLeave", fromName);
        engine.hooks.callHook("scene:leave", fromName);

        overlayStack.pop();
        currentState = target;
        currentParams = params;
        for (const l of listeners) l(fromState, target, params);
        return;
      } else {
        // Normal transition — full lifecycle sequence per the spec:
        // 1. Async leave animation
        await engine.hooks.callHook("scene:transition:leave", {
          from: fromName,
          to: toName,
        });
        // 2. Systems pause + onExit callbacks (awaited for async safety)
        await engine.hooks.callHook("scene:beforeLeave", fromName);
        // 3. Scene fully left
        engine.hooks.callHook("scene:leave", fromName);
      }

      currentState = target;
      currentParams = params;

      // 4. Systems resume + onEnter callbacks (awaited for async safety)
      await engine.hooks.callHook("scene:enter", toName, params);

      // 5. Async enter animation
      await engine.hooks.callHook("scene:transition:enter", {
        from: fromName,
        to: toName,
      });

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

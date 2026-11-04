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

import type { GwenSceneName } from "@gwenjs/schema";
import { useEngine } from "../../engine/context";
import { GwenSceneRouterError } from "../../engine/engine-errors";
import type {
  RouteConfig,
  SceneRouterDefinition,
  SceneRouterHandle,
  EventsOf,
  StatesOf,
} from "../router-types";
import type { SceneDefinition, SceneFactory } from "../../scene/runtime/define-scene";
import { reportRejectedHook } from "../../hooks/report-rejected-hook.js";
import { deleteCachedRouter, getCachedRouter, setCachedRouter } from "./router-cache.js";

type TransitionListener<TRoutes extends Record<string, RouteConfig<TRoutes>>> = (
  from: StatesOf<TRoutes>,
  to: StatesOf<TRoutes>,
  params: Record<string, unknown>,
) => void;

function requireSceneName(
  sceneNameByRoute: Map<string, GwenSceneName>,
  route: string,
): GwenSceneName {
  const name = sceneNameByRoute.get(route);
  if (name !== undefined) return name;
  throw new GwenSceneRouterError(
    `Route "${route}" is not found in routes.`,
    route,
    [...sceneNameByRoute.keys()],
    undefined,
    undefined,
    "useSceneRouter",
  );
}

function resolveScene(input: SceneDefinition | SceneFactory): SceneDefinition {
  if (typeof input === "function") {
    return input({ register: () => {} });
  }
  return input;
}

/** Narrows `key` to a route of `routes`, or throws the router error for an unknown route. */
function requireState<TRoutes extends Record<string, RouteConfig<TRoutes>>>(
  routes: TRoutes,
  key: string,
): StatesOf<TRoutes> {
  if (isState(routes, key)) return key;
  throw new GwenSceneRouterError(
    `Route "${key}" is not found in routes.`,
    key,
    Object.keys(routes),
    undefined,
    undefined,
    "useSceneRouter",
  );
}

/** True when `key` names a route of `routes`. */
function isState<TRoutes extends Record<string, RouteConfig<TRoutes>>>(
  routes: TRoutes,
  key: string,
): key is StatesOf<TRoutes> {
  return Object.prototype.hasOwnProperty.call(routes, key);
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
  const engine = useEngine("useSceneRouter");

  // Singleton cache per (engine, routerDef) pair — stored in a module-level WeakMap
  // so the engine object itself is never mutated.
  const cached = getCachedRouter(engine, routerDef);
  if (cached !== undefined) {
    return cached;
  }

  const { options } = routerDef;
  const routes = options.routes;

  // A hand-built definition can carry a non-string `initial` (a numeric route key): it is
  // looked up as a string key. A string `initial` is taken as is, like `defineSceneRouter` does.
  const initial = options.initial;
  let currentState: StatesOf<TRoutes> =
    typeof initial === "string" ? initial : requireState(routes, String(initial));
  let currentParams: Record<string, unknown> = {};
  const overlayStack: StatesOf<TRoutes>[] = [];
  const listeners: TransitionListener<TRoutes>[] = [];

  // Clear listeners and the cache entry when the engine stops so closures captured
  // by onTransition() handlers do not prevent garbage collection.
  engine.hooks.hook("engine:stop", () => {
    listeners.length = 0;
    deleteCachedRouter(engine, routerDef);
  });

  // Resolve all scene factories eagerly — each factory runs once, registering
  // its onEnter/onExit handlers on engine.hooks. Initial activation is not
  // done here: the generated bootstrap awaits scene:enter before start().
  // Route key → scene name. Hook payloads use `def.name`, never the route key.
  const sceneNameByRoute = new Map<string, GwenSceneName>();
  for (const [routeKey, route] of Object.entries(routes)) {
    const def = resolveScene(route.scene);
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
      const route = routes[currentState];
      return !!(route?.on && String(event) in route.on);
    },

    async send(event: EventsOf<TRoutes>, params: Record<string, unknown> = {}): Promise<void> {
      const route = routes[currentState];
      const rawTarget = route?.on?.[String(event)];

      if (!rawTarget) {
        engine.logger.warn(
          `useSceneRouter: event "${String(event)}" has no transition in state "${String(currentState)}". Ignoring.`,
        );
        return;
      }

      const fromState = currentState;
      const fromName = requireSceneName(sceneNameByRoute, String(fromState));
      const target = requireState(routes, String(rawTarget));
      const toName = requireSceneName(sceneNameByRoute, target);
      const toConfig = routes[target];

      if (toConfig?.overlay) {
        // Push onto overlay stack — do NOT exit current scene
        overlayStack.push(fromState);
      } else if (overlayStack.length > 0 && target === overlayStack[overlayStack.length - 1]) {
        // Popping back to underlying scene — run overlay exit lifecycle, skip underlying onEnter.
        // The underlying scene was never paused (scene:beforeLeave was not fired on enter),
        // so we must not fire scene:enter either — it would double-resume its systems.
        await engine.hooks.callHook("scene:transition:leave", { from: fromName, to: toName });
        await engine.hooks.callHook("scene:beforeLeave", fromName);
        reportRejectedHook(
          engine,
          `scene:${fromName}`,
          "scene:leave",
          engine.hooks.callHook("scene:leave", fromName),
        );

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
        reportRejectedHook(
          engine,
          `scene:${fromName}`,
          "scene:leave",
          engine.hooks.callHook("scene:leave", fromName),
        );
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

  setCachedRouter(engine, routerDef, handle);
  return handle;
}

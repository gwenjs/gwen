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

import { useEngine } from '../context.js';
import type {
  RouteConfig,
  SceneRouterDefinition,
  SceneRouterHandle,
  EventsOf,
  StatesOf,
} from './router-types.js';
import type { SceneDefinition, SceneFactory } from '../scene/define-scene.js';

// Unique symbol to cache router handles on the engine instance
const ROUTER_CACHE = Symbol('gwen.routerCache');

type TransitionListener<TRoutes extends Record<string, RouteConfig<TRoutes>>> = (
  from: StatesOf<TRoutes>,
  to: StatesOf<TRoutes>,
  params: Record<string, unknown>,
) => void;

function resolveScene(input: SceneDefinition | SceneFactory): SceneDefinition {
  if (typeof input === 'function') {
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
  let engine: unknown;
  try {
    engine = useEngine();
  } catch {
    // Rethrow with a useSceneRouter-specific message for test compatibility
    throw new Error(
      '[GWEN] useSceneRouter() must be called inside an active engine context. Call it inside engine.run(), defineActor(), defineSystem(), or scene lifecycle hooks.',
    );
  }

  // Singleton cache per engine
  if (!(engine as any)[ROUTER_CACHE]) {
    (engine as any)[ROUTER_CACHE] = new Map<unknown, SceneRouterHandle<any>>();
  }
  const cache: Map<unknown, SceneRouterHandle<any>> = (engine as any)[ROUTER_CACHE];
  if (cache.has(routerDef)) {
    return cache.get(routerDef)! as SceneRouterHandle<TRoutes>;
  }

  const { options } = routerDef;
  const routes = options.routes;

  let currentState = options.initial as StatesOf<TRoutes>;
  let currentParams: Record<string, unknown> = {};
  const overlayStack: StatesOf<TRoutes>[] = [];
  const listeners: TransitionListener<TRoutes>[] = [];

  // Activate initial scene
  const initialScene = resolveScene(routes[currentState as keyof TRoutes].scene);
  if (initialScene.onEnter) {
    Promise.resolve(initialScene.onEnter()).catch(console.error);
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
          await Promise.resolve(fromScene.onExit());
        }
      }

      currentState = target;
      currentParams = params;

      if (toScene.onEnter) {
        await Promise.resolve(toScene.onEnter(params));
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

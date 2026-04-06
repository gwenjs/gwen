import type { SceneDefinition, SceneFactory } from '../scene/define-scene.js';

/** A scene accepted by a route: either a SceneDefinition or SceneFactory. */
export type SceneInput = SceneDefinition | SceneFactory;

/** Per-route configuration. */
export interface RouteConfig<TRoutes extends Record<string, RouteConfig<TRoutes>>> {
  /** The scene to activate when this state is entered. */
  scene: SceneInput;
  /**
   * Valid transitions from this state.
   * Keys are event names, values are target state keys.
   */
  on?: Partial<Record<string, keyof TRoutes>>;
  /**
   * When true, this scene is overlaid on top of the previous scene
   * (e.g. a pause screen). The underlying scene stays registered.
   * @default false
   */
  overlay?: boolean;
  /**
   * When true AND overlay is true, the underlying scene's systems are
   * paused (onUpdate not called) while this overlay is active.
   * @default false
   */
  pauseUnderlying?: boolean;
}

/** Transition effect configuration. */
export interface TransitionEffect {
  effect: 'fade' | 'none';
  duration?: number;
  color?: string;
}

/** Options for `defineSceneRouter()`. */
export interface SceneRouterOptions<TRoutes extends Record<string, RouteConfig<TRoutes>>> {
  /** The initial active state (must be a key of `routes`). */
  initial: keyof TRoutes;
  /** Route definitions keyed by state name. */
  routes: TRoutes;
  /** Default and per-transition effect configuration. */
  transitions?: {
    default?: TransitionEffect;
    [transition: string]: TransitionEffect | undefined;
  };
}

/** Infer all event names that appear across any route's `on` map. */
export type EventsOf<TRoutes extends Record<string, RouteConfig<TRoutes>>> =
  NonNullable<TRoutes[keyof TRoutes]['on']> extends infer O
    ? O extends Record<infer K, unknown>
      ? K
      : never
    : never;

/** Infer all state keys. */
export type StatesOf<TRoutes extends Record<string, RouteConfig<TRoutes>>> = keyof TRoutes & string;

/**
 * The opaque router definition produced by `defineSceneRouter()`.
 * Pass to `useSceneRouter(router)` to get the runtime handle.
 */
export interface SceneRouterDefinition<TRoutes extends Record<string, RouteConfig<TRoutes>>> {
  readonly __type: 'SceneRouterDefinition';
  readonly options: SceneRouterOptions<TRoutes>;
}

/**
 * Runtime handle returned by `useSceneRouter()`.
 */
export interface SceneRouterHandle<TRoutes extends Record<string, RouteConfig<TRoutes>>> {
  /**
   * Send an FSM event. If the event has no transition in the current state,
   * it is silently ignored (+ console.warn in dev).
   */
  send(event: EventsOf<TRoutes>, params?: Record<string, unknown>): Promise<void>;

  /** Current active state name. */
  readonly current: StatesOf<TRoutes>;

  /** Returns true if the given event has a valid transition in the current state. */
  can(event: EventsOf<TRoutes>): boolean;

  /** Payload from the most recent `send()` call. */
  readonly params: Record<string, unknown>;

  /**
   * Subscribe to state transitions.
   * @returns Unsubscribe function.
   */
  onTransition(
    handler: (
      from: StatesOf<TRoutes>,
      to: StatesOf<TRoutes>,
      params: Record<string, unknown>,
    ) => void,
  ): () => void;
}

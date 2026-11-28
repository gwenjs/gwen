/**
 * @file Scene primitives — `defineScene()` for declaring game scenes.
 *
 * Scenes are discovered automatically by the GWEN Vite plugin, which scans
 * `src/scenes/` for `defineScene()` calls and generates a registration module.
 *
 * The factory is called inside an engine context (the bootstrap wraps
 * `registerScenes` in `engine.run()`), so all engine composables are
 * available: `useEngine()`, `useActor()`, `usePrefab()`, `useSceneRouter()`.
 *
 * Scene-specific composables (`useSystem`, `onEnter`, `onExit`, `onPreload`) are
 * imported from `@gwenjs/core/scene`.
 *
 * @example
 * ```typescript
 * import { defineScene, useSystem, onEnter, onExit } from '@gwenjs/core/scene'
 * import { useActor } from '@gwenjs/core/actor'
 *
 * export const GameScene = defineScene('game', () => {
 *   useSystem([MovementSystem, RenderSystem])
 *
 *   const player = useActor(PlayerActor)
 *   onEnter(() => player.spawnOnce({ x: 400, y: 530 }))
 *   onExit(() => player.despawnAll())
 * })
 * ```
 */

import type { GwenSceneName, ScenePreloadEvent } from "@gwenjs/schema";
import { _withSceneContext } from "./scene-context";
import type { GwenPlugin } from "../../engine/engine-types";
import { engineContext } from "../../engine/context";
import { rememberSceneEngine } from "../../hmr/scene-installs.js";
import type { SystemHandle } from "./system-handle";

// ── Types ─────────────────────────────────────────────────────────────────────

/** Minimal scene registry interface passed to scene factories. */
export interface SceneRegistry {
  /** Register a scene definition with the engine. */
  register(scene: SceneDefinition): void;
}

/** A resolved scene definition ready to be registered with the engine. */
export interface SceneDefinition<N extends GwenSceneName = GwenSceneName> {
  /** Unique scene name used by the engine router. */
  readonly name: N;
  /** Systems that run each frame while this scene is active. */
  readonly systems: GwenPlugin[];
  /**
   * Runtime handles for all systems registered via `useSystem()`.
   * Used by the framework bootstrap to pause inactive scenes and resume them
   * on `scene:enter`. Do not call `_scenePause` / `_sceneResume` from game code.
   * @internal
   */
  readonly handles: SystemHandle[];
  /** Optional callback fired when the engine routes to this scene. */
  readonly onEnter?: (params?: Record<string, unknown>) => void | Promise<void>;
  /** Optional callback fired when the engine routes away from this scene. */
  readonly onExit?: () => void | Promise<void>;
  /** Optional async callback fired before the leave animation (scene:transition:leave). */
  readonly onTransitionExit?: (payload: {
    from: GwenSceneName;
    to: GwenSceneName;
  }) => void | Promise<void>;
  /** Optional async callback fired after the enter animation (scene:transition:enter). */
  readonly onTransitionEnter?: (payload: {
    from: GwenSceneName;
    to: GwenSceneName;
  }) => void | Promise<void>;
  /**
   * Callbacks registered with `onPreload`, in call order.
   * Absent when the factory never calls `onPreload`.
   */
  readonly onPreload?: readonly ((event: ScenePreloadEvent) => void | Promise<void>)[];
}

/**
 * A callable scene factory produced by `defineScene(name, factory)`.
 * Called by the engine bootstrap with the active scene registry.
 * The result is cached after the first call.
 */
export interface SceneFactory<N extends GwenSceneName = GwenSceneName> {
  /** Call to produce the resolved `SceneDefinition`. Result is cached. */
  (registry: SceneRegistry): SceneDefinition<N>;
  /**
   * Scene name — exposed as a property so tooling (Vite plugin, CLI)
   * can identify scenes without executing the factory.
   */
  readonly sceneName: N;
}

// ── Implementation ────────────────────────────────────────────────────────────

/**
 * Define a game scene.
 *
 * The factory receives no arguments. Declare systems and lifecycle hooks
 * via composables:
 * - `useSystem([...])` — systems active while this scene runs
 * - `onEnter(cb)` — called when the engine routes to this scene
 * - `onExit(cb)` — called when the engine routes away from this scene
 * - `onPreload(cb)` — called while this scene is the preload target
 *
 * The factory result is **cached** — the function is only executed once
 * regardless of how many times the returned `SceneFactory` is called.
 *
 * Lifecycle wiring (decoupled from router): when `SceneEnginePlugin` is installed
 * and an engine context is active, `onEnter` / `onExit` / `onPreload` are wired
 * through `SceneHookRegistry` to `scene:enter` / `scene:beforeLeave` /
 * `scene:preload`, with async engine-context propagation.
 * A scene used without that plugin registers no hook.
 * Calling the factory without an engine context (e.g. in tests that access
 * `SceneDefinition.onEnter` directly) still works — the callbacks remain
 * accessible on the returned definition.
 *
 * @param name    Unique scene name (used by the engine router).
 * @param factory Called once at bootstrap to declare systems and hooks.
 *
 * @example
 * ```typescript
 * export const GameScene = defineScene('game', () => {
 *   useSystem([MovementSystem, EnemySystem])
 *
 *   const player = useActor(PlayerActor)
 *   onEnter(() => player.spawnOnce({ x: 400, y: 530 }))
 *   onExit(() => player.despawnAll())
 * })
 * ```
 */
export function defineScene<const N extends GwenSceneName>(
  name: N,
  factory: () => void,
): SceneFactory<N> {
  // The SceneDefinition is engine-independent — factory runs once.
  let _def: SceneDefinition<N> | null = null;

  const call = (_registry: SceneRegistry): SceneDefinition<N> => {
    // Run factory only once — SceneDefinition is engine-independent.
    if (!_def) {
      const ctx = _withSceneContext(factory, call);
      _def = {
        name,
        systems: ctx.systems,
        handles: ctx.handles,
        ...(ctx.onEnterCb !== undefined ? { onEnter: ctx.onEnterCb } : {}),
        ...(ctx.onExitCb !== undefined ? { onExit: ctx.onExitCb } : {}),
        ...(ctx.onTransitionExitCb !== undefined
          ? { onTransitionExit: ctx.onTransitionExitCb }
          : {}),
        ...(ctx.onTransitionEnterCb !== undefined
          ? { onTransitionEnter: ctx.onTransitionEnterCb }
          : {}),
        ...(ctx.onPreloadCbs.length > 0 ? { onPreload: ctx.onPreloadCbs } : {}),
      };
    }

    // Each engine has its own registry, so each one receives the hooks.
    // Without SceneEnginePlugin there is no registry and no hook is registered.
    const engine = engineContext.tryUse();
    if (engine) {
      const hookRegistry = engine.tryInject("scene:hook-registry");
      if (hookRegistry) hookRegistry.hookScene(engine, _def);
      if (__GWEN_DEV__) rememberSceneEngine(call, engine);
    }

    return _def;
  };

  return Object.assign(call, { sceneName: name });
}

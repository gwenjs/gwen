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
 * Scene-specific composables (`useSystem`, `onEnter`, `onExit`) are imported
 * from `@gwenjs/core/scene`.
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

import { _withSceneContext } from "./scene-context";
import type { GwenPlugin, GwenEngine } from "../../engine/gwen-engine";
import { engineContext } from "../../engine/context";
import type { SceneHookRegistry } from "../engine-plugin.js";
import type { SystemHandle } from "./system-handle";

// ── Types ─────────────────────────────────────────────────────────────────────

/** Minimal scene registry interface passed to scene factories. */
export interface SceneRegistry {
  /** Register a scene definition with the engine. */
  register(scene: SceneDefinition): void;
}

/** A resolved scene definition ready to be registered with the engine. */
export interface SceneDefinition {
  /** Unique scene name used by the engine router. */
  readonly name: string;
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
  readonly onTransitionLeave?: (payload: { from: string; to: string }) => void | Promise<void>;
  /** Optional async callback fired after the enter animation (scene:transition:enter). */
  readonly onTransitionEnter?: (payload: { from: string; to: string }) => void | Promise<void>;
}

/**
 * A callable scene factory produced by `defineScene(name, factory)`.
 * Called by the engine bootstrap with the active scene registry.
 * The result is cached after the first call.
 */
export interface SceneFactory {
  /** Call to produce the resolved `SceneDefinition`. Result is cached. */
  (registry: SceneRegistry): SceneDefinition;
  /**
   * Scene name — exposed as a property so tooling (Vite plugin, CLI)
   * can identify scenes without executing the factory.
   */
  readonly sceneName: string;
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
 *
 * The factory result is **cached** — the function is only executed once
 * regardless of how many times the returned `SceneFactory` is called.
 *
 * Lifecycle wiring (decoupled from router): when an engine context is active at
 * factory call time, `onEnter` / `onExit` are wired to `scene:enter` /
 * `scene:beforeLeave` engine hooks with full async engine-context propagation.
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
export function defineScene(name: string, factory: () => void): SceneFactory {
  // The SceneDefinition is engine-independent — factory runs once.
  let _def: SceneDefinition | null = null;
  // Hook registration is per-engine — tracked so each engine gets its own listeners.
  const _registeredEngines = new WeakSet<GwenEngine>();

  /**
   * @deprecated Fallback without SceneEnginePlugin. Will be removed in v2.0.
   *
   * Direct hook registration bypassing SceneHookRegistry.
   * Caller must handle deduplication via _registeredEngines.
   */
  function _registerHooksDirect(engine: GwenEngine, def: SceneDefinition): void {
    if (def.onEnter) {
      const enterCb = def.onEnter;
      engine.hooks.hook("scene:enter", async (sceneName, params) => {
        if (sceneName !== name) return;
        engineContext.set(engine, true);
        try {
          await enterCb(params);
        } finally {
          engineContext.unset();
        }
      });
    }

    if (def.onExit) {
      const exitCb = def.onExit;
      engine.hooks.hook("scene:beforeLeave", async (sceneName) => {
        if (sceneName !== name) return;
        engineContext.set(engine, true);
        try {
          await exitCb();
        } finally {
          engineContext.unset();
        }
      });
    }

    if (def.onTransitionLeave) {
      const leaveCb = def.onTransitionLeave;
      engine.hooks.hook("scene:transition:leave", async (payload) => {
        if (payload.from !== name) return;
        engineContext.set(engine, true);
        try {
          await leaveCb(payload);
        } finally {
          engineContext.unset();
        }
      });
    }

    if (def.onTransitionEnter) {
      const enterCb = def.onTransitionEnter;
      engine.hooks.hook("scene:transition:enter", async (payload) => {
        if (payload.to !== name) return;
        engineContext.set(engine, true);
        try {
          await enterCb(payload);
        } finally {
          engineContext.unset();
        }
      });
    }
  }

  const fn = (_registry: SceneRegistry): SceneDefinition => {
    // Run factory only once — SceneDefinition is engine-independent.
    if (!_def) {
      const ctx = _withSceneContext(factory);
      _def = {
        name,
        systems: ctx.systems,
        handles: ctx.handles,
        onEnter: ctx.onEnterCb,
        onExit: ctx.onExitCb,
        onTransitionLeave: ctx.onTransitionLeaveCb,
        onTransitionEnter: ctx.onTransitionEnterCb,
      };
    }

    // Wire lifecycle hooks for the current engine (if any). Each engine gets
    // its own hook registrations so module-level scene definitions work correctly
    // across multiple engine instances in tests.
    const engine = engineContext.tryUse() as GwenEngine | null;
    if (engine && !_registeredEngines.has(engine)) {
      _registeredEngines.add(engine);
      const hookRegistry = engine.tryInject("scene:hook-registry") as SceneHookRegistry | undefined;
      if (hookRegistry) {
        hookRegistry.hookScene(engine, _def);
      } else {
        // Fallback for tests without SceneEnginePlugin — direct registration (untracked).
        _registerHooksDirect(engine, _def);
      }
    }

    return _def;
  };

  Object.defineProperty(fn, "sceneName", { value: name, writable: false });
  return fn as SceneFactory;
}

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

import { _withSceneContext } from "./scene-context.js";
import type { GwenPlugin } from "../engine/gwen-engine.js";

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
  /** Optional callback fired when the engine routes to this scene. */
  readonly onEnter?: (params?: Record<string, unknown>) => void | Promise<void>;
  /** Optional callback fired when the engine routes away from this scene. */
  readonly onExit?: () => void | Promise<void>;
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
 * The factory runs inside an active engine context so `useEngine()`,
 * `useActor()`, `usePrefab()`, and `useSceneRouter()` are all available.
 *
 * The factory result is **cached** — the function is only executed once
 * regardless of how many times the returned `SceneFactory` is called.
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
  let _cached: SceneDefinition | null = null;

  const fn = (_registry: SceneRegistry): SceneDefinition => {
    if (_cached) return _cached;
    const ctx = _withSceneContext(factory);
    _cached = {
      name,
      systems: ctx.systems,
      onEnter: ctx.onEnterCb,
      onExit: ctx.onExitCb,
    };
    return _cached;
  };

  Object.defineProperty(fn, "sceneName", { value: name, writable: false });
  return fn as SceneFactory;
}

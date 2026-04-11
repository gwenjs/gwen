/**
 * @file Scene composable context.
 *
 * Provides the module-level context variable and composables for `defineScene()`.
 * Pattern is identical to the actor context in `define-actor.ts`.
 *
 * Composables valid inside a `defineScene()` factory:
 * - `useSystem(plugins)` — declare active systems
 * - `onEnter(cb)` — callback when scene is entered
 * - `onExit(cb)` — callback when scene is exited
 */

import { GwenContextError } from "../context.js";
import type { GwenPlugin } from "../engine/gwen-engine.js";

// ─── Internal context type ────────────────────────────────────────────────────

export interface SceneSetupContext {
  systems: GwenPlugin[];
  onEnterCb?: (params?: Record<string, unknown>) => void | Promise<void>;
  onExitCb?: () => void | Promise<void>;
}

// ─── Module-level context slot ────────────────────────────────────────────────

/**
 * The active scene setup context. Set by `_withSceneContext`, cleared after.
 * @internal
 */
let _currentSceneCtx: SceneSetupContext | null = null;

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Run `factory` inside a fresh scene context, then return the captured context.
 * Restores any previous context on completion (supports nested calls).
 * @internal
 */
export function _withSceneContext(factory: () => void): SceneSetupContext {
  const prev = _currentSceneCtx;
  const ctx: SceneSetupContext = { systems: [] };
  _currentSceneCtx = ctx;
  try {
    factory();
  } finally {
    _currentSceneCtx = prev;
  }
  return ctx;
}

// ─── Public composables ───────────────────────────────────────────────────────

/**
 * Declare the systems that run while this scene is active.
 *
 * Must be called inside a `defineScene()` factory.
 *
 * @param plugins - Array of system plugins to activate for this scene.
 * @throws {GwenContextError} If called outside a `defineScene()` factory.
 *
 * @example
 * ```ts
 * defineScene('Game', () => {
 *   useSystem([MovementSystem, RenderSystem])
 * })
 * ```
 */
export function useSystem(plugins: GwenPlugin[]): void {
  if (!_currentSceneCtx) {
    throw new GwenContextError("[GWEN] useSystem() must be called inside a defineScene() factory.");
  }
  _currentSceneCtx.systems.push(...plugins);
}

/**
 * Register a callback to run when this scene becomes active.
 *
 * Must be called inside a `defineScene()` factory.
 *
 * @param cb - Called when the scene is entered. Receives optional params from `nav.send()`.
 * @throws {GwenContextError} If called outside a `defineScene()` factory.
 *
 * @example
 * ```ts
 * defineScene('Game', () => {
 *   const player = useActor(PlayerActor)
 *   onEnter((params) => player.spawnOnce({ x: 400, y: 530 }))
 * })
 * ```
 */
export function onEnter(cb: (params?: Record<string, unknown>) => void | Promise<void>): void {
  if (!_currentSceneCtx) {
    throw new GwenContextError("[GWEN] onEnter() must be called inside a defineScene() factory.");
  }
  _currentSceneCtx.onEnterCb = cb;
}

/**
 * Register a callback to run when this scene is deactivated.
 *
 * Must be called inside a `defineScene()` factory.
 *
 * @param cb - Called when the engine routes away from this scene.
 * @throws {GwenContextError} If called outside a `defineScene()` factory.
 *
 * @example
 * ```ts
 * defineScene('Game', () => {
 *   const player = useActor(PlayerActor)
 *   onExit(() => player.despawnAll())
 * })
 * ```
 */
export function onExit(cb: () => void | Promise<void>): void {
  if (!_currentSceneCtx) {
    throw new GwenContextError("[GWEN] onExit() must be called inside a defineScene() factory.");
  }
  _currentSceneCtx.onExitCb = cb;
}

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

import { GwenContextError, engineContext } from "../../engine/context";
import type { GwenEngine, GwenPlugin } from "../../engine/gwen-engine";
import { ContextSlot } from "../../engine/context-slot";
import { createSystemHandle } from "./system-handle";
import type { SystemHandle } from "./system-handle";
import { SCENE_REGISTRAR_KEY } from "./scene-registrar";
import type { SceneRegistrar } from "./scene-registrar";

// ─── Internal context type ────────────────────────────────────────────────────

export interface SceneSetupContext {
  systems: GwenPlugin[];
  onEnterCb?: (params?: Record<string, unknown>) => void | Promise<void>;
  onExitCb?: () => void | Promise<void>;
  onTransitionLeaveCb?: (payload: { from: string; to: string }) => void | Promise<void>;
  onTransitionEnterCb?: (payload: { from: string; to: string }) => void | Promise<void>;
  registrar?: SceneRegistrar;
}

// ─── Module-level context slot ────────────────────────────────────────────────

/**
 * The active scene setup context. Set by `_withSceneContext`, cleared after.
 * @internal
 */
const _sceneCtx = new ContextSlot<SceneSetupContext>();

function _getActiveSceneContext(): SceneSetupContext | null {
  return _sceneCtx.get();
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Run `factory` inside a fresh scene context, then return the captured context.
 * Restores any previous context on completion (supports nested calls).
 * @internal
 */
export function _withSceneContext(factory: () => void): SceneSetupContext {
  const ctx: SceneSetupContext = { systems: [] };

  // Build an idempotent registrar and expose it via engine.provide() so that
  // useActor() / useActorPool() can call engine.inject(SCENE_REGISTRAR_KEY)
  // without importing anything from this module (no actor→scene coupling).
  const registrar: SceneRegistrar = {
    register(plugin: GwenPlugin): void {
      if (ctx.systems.includes(plugin)) return;
      ctx.systems.push(plugin);
    },
  };
  ctx.registrar = registrar;

  // Provide the registrar for the duration of the factory call.
  // engine.provide() is a simple Map.set — safe to call each time.
  const engine = engineContext.tryUse() as GwenEngine | null;
  if (engine) engine.provide(SCENE_REGISTRAR_KEY, registrar);

  _sceneCtx.run(ctx, factory);
  return ctx;
}

/**
 * Register a plugin against the active scene context, if any.
 * Used by scene-aware composables such as `useActor()` so bootstrap can
 * install all required plugins before scene lifecycle hooks run.
 * @internal
 */
export function _registerScenePlugin(plugin: GwenPlugin): void {
  const ctx = _getActiveSceneContext();
  if (!ctx) return;
  if (ctx.systems.includes(plugin)) return;
  ctx.systems.push(plugin);
}

// ─── Public composables ───────────────────────────────────────────────────────
/**
 * Register a system to run while this scene is active.
 *
 * Must be called inside a `defineScene()` factory. Each call registers one
 * system and returns a `SystemHandle` for runtime lifecycle control.
 *
 * **Collect pass:** if the plugin produced by `defineSystem()` exposes a
 * `_discover()` method, `useSystem` runs it before registration. The collect
 * pass executes the system's setup function with no-op frame callbacks so
 * that `useActor()` calls inside the factory register their actor plugins as
 * scene dependencies. Actor plugins are therefore installed before this
 * system during the bootstrap — the correct installation order is guaranteed
 * automatically.
 *
 * @param plugin - A plugin produced by calling a `defineSystem()` factory,
 *                 e.g. `MovementSystem()` or `CombatSystem(player)`.
 * @returns A {@link SystemHandle} with `pause()`, `resume()`, and `destroy()`.
 *
 * @throws {GwenContextError} If called outside a `defineScene()` factory.
 *
 * @example
 * ```ts
 * defineScene('game', () => {
 *   const player = useActor(PlayerActor)
 *
 *   const movement = useSystem(MovementSystem())
 *   const combat   = useSystem(CombatSystem(player))
 *
 *   onEnter(() => player.spawnOnce({ x: 400, y: 530 }))
 *   onExit(() => player.despawnAll())
 * })
 * ```
 */
export function useSystem(plugin: GwenPlugin): SystemHandle {
  const ctx = _getActiveSceneContext();
  if (!ctx) {
    throw new GwenContextError("[GWEN] useSystem() must be called inside a defineScene() factory.");
  }

  // Collect pass: run the system setup in no-op mode to discover useActor() deps.
  // This must happen BEFORE we push the wrapped plugin so that discovered actor
  // plugins appear earlier in ctx.systems — actors must be installed before
  // the systems that depend on them.
  const discoverable = plugin as { _discover?: () => void };
  if (typeof discoverable._discover === "function") {
    discoverable._discover();
  }

  // Wrap the plugin with pause/resume/destroy lifecycle gates.
  const { plugin: wrappedPlugin, handle } = createSystemHandle(plugin);
  ctx.systems.push(wrappedPlugin);

  return handle;
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
  const ctx = _getActiveSceneContext();
  if (!ctx) {
    throw new GwenContextError("[GWEN] onEnter() must be called inside a defineScene() factory.");
  }
  ctx.onEnterCb = cb;
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
  const ctx = _getActiveSceneContext();
  if (!ctx) {
    throw new GwenContextError("[GWEN] onExit() must be called inside a defineScene() factory.");
  }
  ctx.onExitCb = cb;
}

/**
 * Register an async callback that runs before the leave animation for this scene.
 *
 * Fires on `scene:transition:leave` when this scene is the one being left.
 * Awaited before `onExit` — use it to play a fade-out or slide animation.
 *
 * Must be called inside a `defineScene()` factory.
 *
 * @param cb - Receives `{ from, to }` — the scene names involved in the transition.
 * @throws {GwenContextError} If called outside a `defineScene()` factory.
 *
 * @example
 * ```ts
 * defineScene('Game', () => {
 *   onTransitionLeave(async ({ to }) => {
 *     await fadeOut(300)
 *   })
 * })
 * ```
 */
export function onTransitionLeave(
  cb: (payload: { from: string; to: string }) => void | Promise<void>,
): void {
  const ctx = _getActiveSceneContext();
  if (!ctx) {
    throw new GwenContextError(
      "[GWEN] onTransitionLeave() must be called inside a defineScene() factory.",
    );
  }
  ctx.onTransitionLeaveCb = cb;
}

/**
 * Register an async callback that runs after the scene becomes active.
 *
 * Fires on `scene:transition:enter` after `onEnter` completes.
 * Awaited — use it to play a fade-in or slide-in animation.
 *
 * Must be called inside a `defineScene()` factory.
 *
 * @param cb - Receives `{ from, to }` — the scene names involved in the transition.
 * @throws {GwenContextError} If called outside a `defineScene()` factory.
 *
 * @example
 * ```ts
 * defineScene('Game', () => {
 *   onTransitionEnter(async ({ from }) => {
 *     await slideIn(400)
 *   })
 * })
 * ```
 */
export function onTransitionEnter(
  cb: (payload: { from: string; to: string }) => void | Promise<void>,
): void {
  const ctx = _getActiveSceneContext();
  if (!ctx) {
    throw new GwenContextError(
      "[GWEN] onTransitionEnter() must be called inside a defineScene() factory.",
    );
  }
  ctx.onTransitionEnterCb = cb;
}

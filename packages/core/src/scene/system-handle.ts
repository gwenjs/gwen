/**
 * @file SystemHandle — lifecycle control for a single system within a scene.
 *
 * `createSystemHandle()` wraps a `GwenPlugin` produced by a `defineSystem()`
 * factory call. The wrapped plugin gates all frame callbacks behind two
 * independent boolean flags:
 *
 * - `_userPaused` — controlled by the developer via `pause()` / `resume()`.
 * - `_scenePaused` — controlled by the `SceneRuntime` during overlay transitions.
 *
 * A system ticks only when **both** flags are `false`. This guarantees that a
 * system the developer intentionally paused is never silently reactivated by a
 * scene-level resume (e.g. returning from a pause-menu overlay).
 *
 * @example
 * ```typescript
 * const combat = useSystem(CombatSystem(player))
 *
 * // Pause during a cinematic:
 * combat.pause()
 *
 * // Player opens pause menu → SceneRuntime freezes the scene (internal):
 * //   combat._scenePause()   ← called by SceneRuntime, not by the developer
 *
 * // Player resumes → SceneRuntime unfreezes:
 * //   combat._sceneResume()  ← combat is still _userPaused, stays inactive
 *
 * // After the cinematic ends:
 * combat.resume()  // combat is active again
 * ```
 */

import type { GwenPlugin } from "../engine/gwen-engine";

// ─── Public interface ─────────────────────────────────────────────────────────

/**
 * Handle returned by `useSystem()`. Provides runtime lifecycle control over a
 * single system within its parent scene.
 *
 * Frame callbacks (`onUpdate`, `onBeforeUpdate`, `onAfterUpdate`, `onRender`)
 * are gated behind two independent pause flags. See {@link createSystemHandle}
 * for the full two-flag pause model.
 */
export interface SystemHandle {
  /**
   * Stop all frame callbacks (`onUpdate`, `onBeforeUpdate`, `onAfterUpdate`,
   * `onRender`). System state (queries, captured references) is preserved.
   * Call `resume()` to restart callbacks without re-initialisation.
   */
  pause(): void;

  /**
   * Restart frame callbacks after a developer-initiated `pause()`.
   *
   * Has no immediate visible effect if the scene is currently frozen by a
   * scene-level pause (overlay): the system will begin ticking again once
   * the scene itself is unfrozen.
   */
  resume(): void;

  /**
   * Permanently remove this system from the frame loop.
   *
   * After `destroy()`, the system never ticks again regardless of subsequent
   * `pause()` / `resume()` calls. In Phase 2, `destroy()` will also remove
   * the plugin from the `SceneRuntime` registry.
   */
  destroy(): void;

  /**
   * `true` when the system is currently ticking (neither developer-paused,
   * scene-paused, nor destroyed).
   */
  readonly active: boolean;

  /**
   * Freeze this system as part of a scene-level pause (overlay transition).
   *
   * Only called by the `SceneRuntime`; do not call directly from game code.
   * @internal
   */
  _scenePause(): void;

  /**
   * Unfreeze this system after a scene-level resume.
   *
   * Only restores activity if the developer has not independently paused the
   * system (`_userPaused === false`). Destroyed systems remain inactive.
   *
   * Only called by the `SceneRuntime`; do not call directly from game code.
   * @internal
   */
  _sceneResume(): void;
}

// ─── Implementation ───────────────────────────────────────────────────────────

/**
 * Wraps a `GwenPlugin` with a `SystemHandle` that gates all frame callbacks
 * behind two independent pause flags.
 *
 * The **wrapped plugin** is what gets passed to `engine.use()` during the
 * scene bootstrap. Its frame callbacks (`onUpdate`, `onBeforeUpdate`, etc.)
 * delegate to the original plugin only when the handle is active.
 *
 * The **handle** is returned to the developer by `useSystem()` and exposes
 * `pause()`, `resume()`, and `destroy()`.
 *
 * @param inner - A `GwenPlugin` produced by a `defineSystem()` factory call.
 * @returns `{ plugin, handle }` — install `plugin` via `engine.use()`;
 *          expose `handle` to the developer.
 *
 * @example
 * ```typescript
 * // Inside useSystem():
 * const { plugin: wrappedPlugin, handle } = createSystemHandle(calledPlugin);
 * ctx.systems.push(wrappedPlugin);
 * return handle;
 * ```
 */
export function createSystemHandle(inner: GwenPlugin): {
  plugin: GwenPlugin;
  handle: SystemHandle;
} {
  let _userPaused = false;
  let _scenePaused = false;
  let _destroyed = false;

  /** A system is active only when none of its three inactive flags are set. */
  const isActive = (): boolean => !_userPaused && !_scenePaused && !_destroyed;

  const handle: SystemHandle = {
    pause(): void {
      _userPaused = true;
    },

    resume(): void {
      _userPaused = false;
    },

    destroy(): void {
      _destroyed = true;
    },

    get active(): boolean {
      return isActive();
    },

    _scenePause(): void {
      _scenePaused = true;
    },

    _sceneResume(): void {
      // Only clear the scene flag — never touch _userPaused.
      // A system the developer paused before the scene freeze must
      // remain paused when the scene unfreezes.
      if (!_destroyed) _scenePaused = false;
    },
  };

  const plugin: GwenPlugin = {
    name: inner.name,

    setup: (engine) => inner.setup(engine),

    onBeforeUpdate: inner.onBeforeUpdate
      ? (dt: number): void => {
          if (isActive()) inner.onBeforeUpdate!(dt);
        }
      : undefined,

    onUpdate: inner.onUpdate
      ? (dt: number): void => {
          if (isActive()) inner.onUpdate!(dt);
        }
      : undefined,

    onAfterUpdate: inner.onAfterUpdate
      ? (dt: number): void => {
          if (isActive()) inner.onAfterUpdate!(dt);
        }
      : undefined,

    onRender: inner.onRender
      ? (): void => {
          if (isActive()) inner.onRender!();
        }
      : undefined,

    onError: inner.onError ? (...args) => inner.onError!(...args) : undefined,
  };

  return { plugin, handle };
}

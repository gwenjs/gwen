/**
 * @file SystemHandle — lifecycle control for a single system within a scene.
 *
 * `createSystemHandle()` wraps a `GwenPlugin` produced by a `defineSystem()`
 * factory call. Frame callbacks are hooks registered in `setup`. Pause and
 * resume flip two independent boolean flags:
 *
 * - `_userPaused` — controlled by the developer via `pause()` / `resume()`.
 * - `_scenePaused` — controlled by the `SceneRuntime` during overlay transitions.
 *
 * `active` is true only when both pause flags are false, the handle is not
 * destroyed, and it is not isolated. Inner hooks move only when the plugin
 * exposes `_pause`. A developer pause survives a scene resume.
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

import type { GwenPlugin } from "../../engine/engine-types";
import type { DiscoverablePlugin } from "../../system/runtime/define-system";

/** Duck-typed check — true when `_pause` is a function. */
function isScopedPlugin(p: GwenPlugin): p is DiscoverablePlugin {
  return typeof (p as DiscoverablePlugin)._pause === "function";
}

// ─── Public interface ─────────────────────────────────────────────────────────

/**
 * Handle returned by `useSystem()`. Provides runtime lifecycle control over a
 * single system within its parent scene.
 *
 * Frame callbacks are hooks registered in `setup`. See {@link createSystemHandle}
 * for the full two-flag pause model.
 */
export interface SystemHandle {
  /**
   * Set the developer pause flag. Calls `inner._pause()` only when the
   * inner plugin exposes `_pause`. State is preserved.
   * Call `resume()` to clear the flag.
   */
  pause(): void;

  /**
   * Clear the developer pause flag. Calls `inner._resume()` only when the
   * plugin exposes `_pause` and the handle is then active.
   * A scene pause keeps it inactive until `_sceneResume()`.
   */
  resume(): void;

  /**
   * Set `_destroyed`. `active` stays false afterwards.
   * `resume()` and `_sceneResume()` do not clear the flag.
   */
  destroy(): void;

  /**
   * `true` when the system is currently ticking (neither developer-paused,
   * scene-paused, destroyed, nor isolated).
   * Isolation is its own flag: `resume()` does not clear it.
   */
  readonly active: boolean;

  /**
   * `true` after this system threw and until `engine.reenable(id)`.
   * While `true`, `active` is `false`. `resume()` does not clear it.
   */
  readonly isolated: boolean;

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
 * Wraps a `GwenPlugin` with a `SystemHandle`. Frame callbacks are hooks the
 * inner plugin registers in `setup`. This wrapper does not declare them.
 *
 * The **wrapped plugin** is what gets passed to `engine.use()` during the
 * scene bootstrap. `pause()` and `resume()` call the inner plugin when it
 * exposes `_pause`.
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

  const isIsolatedNow = (): boolean =>
    typeof (inner as DiscoverablePlugin)._isIsolated === "function" &&
    (inner as DiscoverablePlugin)._isIsolated();

  /** A system is active only when none of its inactive flags are set and it is not isolated. */
  const isActive = (): boolean => !_userPaused && !_scenePaused && !_destroyed && !isIsolatedNow();

  const handle: SystemHandle = {
    pause(): void {
      _userPaused = true;
      if (isScopedPlugin(inner)) inner._pause();
    },

    resume(): void {
      // Clears the developer pause only. Isolation stays until engine.reenable().
      _userPaused = false;
      if (isActive() && isScopedPlugin(inner)) inner._resume();
    },

    destroy(): void {
      _destroyed = true;
    },

    get active(): boolean {
      return isActive();
    },

    get isolated(): boolean {
      return isIsolatedNow();
    },

    _scenePause(): void {
      _scenePaused = true;
      if (isScopedPlugin(inner)) inner._pause();
    },

    _sceneResume(): void {
      // Only clear the scene flag — never touch _userPaused.
      // A system the developer paused before the scene freeze must
      // remain paused when the scene unfreezes.
      if (!_destroyed) {
        _scenePaused = false;
        if (isActive() && isScopedPlugin(inner)) inner._resume();
      }
    },
  };

  const plugin: GwenPlugin = {
    name: inner.name,
    setup: (engine: Parameters<GwenPlugin["setup"]>[0]) => inner.setup(engine),
    ...(inner.teardown !== undefined ? { teardown: () => inner.teardown?.() } : {}),
    ...(inner.onError !== undefined
      ? {
          onError: (...args: Parameters<NonNullable<GwenPlugin["onError"]>>) =>
            inner.onError?.(...args),
        }
      : {}),
  };

  return { plugin, handle };
}

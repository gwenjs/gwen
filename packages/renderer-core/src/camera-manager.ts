// packages/renderer-core/src/camera-manager.ts
/**
 * @file CameraManager — per-frame camera state store.
 *
 * Written once per frame by CameraSystem (camera-core), read by renderers.
 * Priority resolution: if an existing state for a viewport has strictly higher
 * priority than the incoming state, the incoming state is ignored. Equal
 * priority = last write wins.
 */

import type { CameraState } from "./camera-types.js";

/**
 * Source of truth for the active camera state per viewport, updated each frame.
 *
 * @example
 * ```ts
 * const cameras = useCameraManager()
 * const state = cameras.get('main')
 * if (state?.active) { ... }
 * ```
 */
export interface CameraManager {
  /**
   * Write the camera state for a viewport. Respects priority:
   * if an existing state has strictly higher priority, this call is a no-op.
   */
  set(viewportId: string, state: CameraState): void;
  /** Read the current camera state for a viewport, or `undefined` if none. */
  get(viewportId: string): CameraState | undefined;
  /** All current states. The returned map is live — do not mutate it. */
  getAll(): ReadonlyMap<string, CameraState>;
  /**
   * Clear all states. Called by CameraSystem at the start of each frame before
   * writing new states so stale entries do not persist.
   */
  clearFrame(): void;
}

export class CameraManagerImpl implements CameraManager {
  private readonly _states = new Map<string, CameraState>();

  set(viewportId: string, state: CameraState): void {
    const existing = this._states.get(viewportId);
    if (existing !== undefined && existing.priority > state.priority) return;
    this._states.set(viewportId, state);
  }

  get(viewportId: string): CameraState | undefined {
    return this._states.get(viewportId);
  }

  getAll(): ReadonlyMap<string, CameraState> {
    return this._states;
  }

  clearFrame(): void {
    this._states.clear();
  }
}

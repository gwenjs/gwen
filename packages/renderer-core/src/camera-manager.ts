// packages/renderer-core/src/camera-manager.ts
/**
 * @file CameraManager — per-frame camera state store.
 *
 * Written once per frame by CameraSystem (camera-core), read by renderers.
 * Priority resolution: if an existing state for a viewport has strictly higher
 * priority than the incoming state, the incoming state is ignored. Equal
 * priority = last write wins.
 */

import type { CameraState, CameraStateStore as CameraManager } from "@gwenjs/schema";

/** Same type as schema {@link CameraStateStore}. */
export type { CameraManager };

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

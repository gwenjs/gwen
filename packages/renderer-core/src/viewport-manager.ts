// packages/renderer-core/src/viewport-manager.ts
/**
 * @file ViewportManager — screen region registry.
 *
 * Tracks named viewport regions. Emits engine hooks when viewports are
 * added, resized, or removed. Consumed by renderer-html and renderer-webgl
 * to size/position their render containers.
 */

import type { ViewportContext, ViewportRegion } from "./camera-types.js";

/**
 * Registry of named screen regions.
 *
 * @example
 * ```ts
 * const viewports = useViewportManager()
 * viewports.set('p1', { x: 0, y: 0, width: 0.5, height: 1 })
 * viewports.set('p2', { x: 0.5, y: 0, width: 0.5, height: 1 })
 * viewports.remove('main')
 * ```
 */
export interface ViewportManager {
  /**
   * Register or update a viewport. Emits `viewport:add` on first registration,
   * `viewport:resize` on update.
   */
  set(id: string, region: ViewportRegion): void;
  /** Remove a viewport. Emits `viewport:remove`. No-op for unknown ids. */
  remove(id: string): void;
  /** Read a viewport context, or `undefined` if not registered. */
  get(id: string): ViewportContext | undefined;
  /** All registered viewports. The returned map is live — do not mutate it. */
  getAll(): ReadonlyMap<string, ViewportContext>;
}

/** @internal — injected by getOrCreateViewportManager */
export type ViewportCallHook = (event: string, payload: unknown) => void;

export class ViewportManagerImpl implements ViewportManager {
  private readonly _viewports = new Map<string, ViewportContext>();
  private readonly _callHook: ViewportCallHook;

  constructor(callHook: ViewportCallHook) {
    this._callHook = callHook;
  }

  set(id: string, region: ViewportRegion): void {
    const isNew = !this._viewports.has(id);
    this._viewports.set(id, { id, region });
    if (isNew) {
      this._callHook("viewport:add", { id, region });
    } else {
      this._callHook("viewport:resize", { id, region });
    }
  }

  remove(id: string): void {
    if (!this._viewports.has(id)) return;
    this._viewports.delete(id);
    this._callHook("viewport:remove", { id });
  }

  get(id: string): ViewportContext | undefined {
    return this._viewports.get(id);
  }

  getAll(): ReadonlyMap<string, ViewportContext> {
    return this._viewports;
  }
}

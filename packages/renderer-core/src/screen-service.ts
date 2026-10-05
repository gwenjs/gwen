/**
 * @file ScreenService — per-viewport pixel dimensions and world bounds.
 *
 * `ScreenServiceImpl` is created by `getOrCreateScreenService()` and injected
 * into the engine as `'screenService'`. Game code accesses it through `useScreen()`.
 * Plugin authors access it through `getOrCreateScreenService(engine)`.
 */

import type { IGwenLogger as GwenLogger } from "@gwenjs/schema";
import { ScreenErrorCodes } from "./screen-errors.js";
import type { ViewportManager } from "./viewport-manager.js";

// ── Public types ─────────────────────────────────────────────────────────────

/**
 * Pixel dimensions of a named viewport.
 * Computed as `containerSize × normalizedRegion`, updated on container resize.
 */
export interface ViewportPixels {
  width: number;
  height: number;
}

/**
 * Axis-aligned world-space bounds for a viewport.
 * Valid for orthographic cameras without rotation.
 * External camera plugins may extend this type via TypeScript declaration merging.
 *
 * @remarks
 * Populated by the registered {@link ViewportBoundsProvider} each frame (in `engine:afterTick`).
 * `undefined` when no provider is registered or when the provider returns `undefined`
 * (e.g. no active camera, unsupported projection type).
 */
export interface ViewportBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/**
 * The stable object returned by `useScreen()`.
 *
 * Mutated in place every frame — never recreated. Safe to capture in closures
 * and async callbacks. All consumers sharing the same viewport id get the same
 * object reference.
 *
 * @example
 * ```ts
 * const screen = useScreen('main')
 *
 * onUpdate(() => {
 *   // Clamp player to world bounds
 *   if (screen.bounds) {
 *     Position.x[id] = Math.max(screen.bounds.minX, Math.min(screen.bounds.maxX, Position.x[id]))
 *   }
 * })
 * ```
 */
export interface ViewportScreenInfo {
  /**
   * Pixel dimensions of this viewport (container width/height × normalized region).
   * Updated whenever the container resizes.
   */
  readonly pixels: ViewportPixels;
  /**
   * Device pixel ratio at last resize event.
   * Updated whenever the container resizes.
   */
  readonly dpr: number;
  /**
   * World-space bounds for this viewport.
   * Updated every frame in `engine:afterTick` by the registered `ViewportBoundsProvider`.
   * `undefined` if no bounds provider is installed or the provider returned `undefined`.
   */
  readonly bounds: ViewportBounds | undefined;
}

/**
 * Computes world-space bounds for a viewport given its pixel dimensions.
 *
 * Implemented by camera plugins (`camera-core`, `camera2d`, `camera3d`) and registered
 * via `getOrCreateScreenService(engine).registerBoundsProvider(provider)`.
 *
 * @example Orthographic implementation (camera-core)
 * ```ts
 * const provider: ViewportBoundsProvider = {
 *   compute(viewportId, pixelW, pixelH) {
 *     const cam = cameraManager.get(viewportId)
 *     if (!cam?.active || cam.projection.type !== 'orthographic') return undefined
 *     const ww = pixelW / cam.projection.zoom
 *     const wh = pixelH / cam.projection.zoom
 *     return {
 *       minX: cam.worldTransform.position.x - ww / 2,
 *       maxX: cam.worldTransform.position.x + ww / 2,
 *       minY: cam.worldTransform.position.y - wh / 2,
 *       maxY: cam.worldTransform.position.y + wh / 2,
 *     }
 *   }
 * }
 * ```
 */
export interface ViewportBoundsProvider {
  /**
   * Compute world-space bounds for the given viewport.
   *
   * @param viewportId - The viewport identifier (e.g. `'main'`).
   * @param pixelWidth - Current pixel width of the viewport.
   * @param pixelHeight - Current pixel height of the viewport.
   * @returns Bounds object, or `undefined` if bounds cannot be computed
   *   (no active camera, unsupported projection type, etc.).
   */
  compute(viewportId: string, pixelWidth: number, pixelHeight: number): ViewportBounds | undefined;
}

/**
 * Runtime interface for the screen service.
 * Accessible to plugin authors via `getOrCreateScreenService(engine)`.
 * Game code should use `useScreen()` instead.
 */
export interface ScreenService {
  /**
   * Register a bounds provider. Last registered wins.
   * Called by camera plugins during `setup(engine)`.
   */
  registerBoundsProvider(provider: ViewportBoundsProvider): void;

  /** Returns `true` if a bounds provider has been registered. */
  hasBoundsProvider(): boolean;

  /**
   * Compute bounds for a specific viewport on demand.
   * Primarily used in tests to verify provider behaviour.
   */
  computeBoundsFor(viewportId: string, pixelW: number, pixelH: number): ViewportBounds | undefined;

  /**
   * Update the container size and recalculate pixel dimensions for all tracked viewports.
   * Called by `ScreenPlugin` on container resize.
   *
   * @param width - New container width in CSS pixels.
   * @param height - New container height in CSS pixels.
   * @param dpr - Optional device pixel ratio.
   */
  setContainerSize(width: number, height: number, dpr?: number): void;

  /**
   * Return or create the stable `ViewportScreenInfo` for a viewport id.
   * Creates with zero dimensions if the viewport is not yet registered in `ViewportManager`
   * (optimistic — pixels are updated when `setContainerSize` is next called).
   */
  getOrCreateInfo(viewportId: string): ViewportScreenInfo;

  /**
   * Remove the cached info for a viewport. Called by `ScreenPlugin` on `viewport:remove`.
   * The removed info is no longer updated by `setContainerSize` or `computeAllBounds`.
   */
  removeViewport(viewportId: string): void;

  /**
   * Compute and mutate bounds in place for all tracked viewports.
   * Called once per frame by `ScreenPlugin` via `engine:afterTick`.
   */
  computeAllBounds(): void;
}

// ── Internal mutable shape (not exported) ────────────────────────────────────

/** Mutable store. Same shape as the readonly {@link ViewportScreenInfo} view. */
interface _MutableInfo {
  pixels: ViewportPixels;
  dpr: number;
  bounds: ViewportBounds | undefined;
}

// ── Implementation ────────────────────────────────────────────────────────────

/** @internal — created by getOrCreateScreenService, not exported directly. */
export class ScreenServiceImpl implements ScreenService {
  private readonly _log: GwenLogger;
  private readonly _vm: ViewportManager;
  private readonly _infos = new Map<string, _MutableInfo>();
  private _cw = 0;
  private _ch = 0;
  private _dpr = 1;
  private _provider: ViewportBoundsProvider | undefined;

  constructor(log: GwenLogger, vm: ViewportManager) {
    this._log = log;
    this._vm = vm;
  }

  registerBoundsProvider(provider: ViewportBoundsProvider): void {
    this._provider = provider;
  }

  hasBoundsProvider(): boolean {
    return this._provider !== undefined;
  }

  computeBoundsFor(viewportId: string, pixelW: number, pixelH: number): ViewportBounds | undefined {
    return this._provider?.compute(viewportId, pixelW, pixelH);
  }

  setContainerSize(width: number, height: number, dpr?: number): void {
    this._cw = width;
    this._ch = height;
    if (dpr !== undefined) this._dpr = dpr;
    for (const [id, info] of this._infos) {
      this._refreshPixels(id, info);
    }
  }

  getOrCreateInfo(viewportId: string): ViewportScreenInfo {
    const existing = this._infos.get(viewportId);
    if (existing) return existing;

    const info: _MutableInfo = {
      pixels: { width: 0, height: 0 },
      dpr: this._dpr,
      bounds: undefined,
    };
    this._refreshPixels(viewportId, info);
    this._infos.set(viewportId, info);
    return info;
  }

  removeViewport(viewportId: string): void {
    this._infos.delete(viewportId);
  }

  computeAllBounds(): void {
    if (!this._provider) return;
    for (const [id, info] of this._infos) {
      const result = this._provider.compute(id, info.pixels.width, info.pixels.height);
      if (result) {
        if (!info.bounds) {
          info.bounds = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
        }
        info.bounds.minX = result.minX;
        info.bounds.maxX = result.maxX;
        info.bounds.minY = result.minY;
        info.bounds.maxY = result.maxY;
      } else {
        info.bounds = undefined;
      }
    }
  }

  private _refreshPixels(id: string, info: _MutableInfo): void {
    const region = this._vm.get(id)?.region;
    if (!region) {
      if (this._cw > 0 || this._ch > 0) {
        const known = [...this._vm.getAll().keys()];
        this._log.warn(
          `[${ScreenErrorCodes.ViewportNotFound}] useScreen('${id}') — viewport '${id}' is not registered in ViewportManager. ` +
            `Known viewports: [${known.length > 0 ? known.map((v) => `'${v}'`).join(", ") : "none"}]. ` +
            `Declare it in gwen.config.ts under viewports:{} or check the viewport id for typos. ` +
            `See: https://gwenengine.dev/docs/screen#viewports`,
        );
      }
      return;
    }
    info.pixels.width = Math.round(this._cw * region.width);
    info.pixels.height = Math.round(this._ch * region.height);
    info.dpr = this._dpr;
  }
}

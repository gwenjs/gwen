/**
 * @file ScreenService — per-viewport pixel dimensions and world bounds.
 *
 * `ScreenServiceImpl` is created by `getOrCreateScreenService()` and injected
 * into the engine as `'screenService'`. Game code accesses it through `useScreen()`.
 * Plugin authors access it through `getOrCreateScreenService(engine)`.
 *
 * The contract type is {@link ScreenInfoStore} in `@gwenjs/schema`, re-exported
 * here as `ScreenService`.
 */

import type {
  IGwenLogger as GwenLogger,
  ScreenInfoStore as ScreenService,
  ViewportBounds,
  ViewportBoundsProvider,
  ViewportPixels,
  ViewportScreenInfo,
} from "@gwenjs/schema";
import { ScreenErrorCodes } from "./screen-errors.js";
import type { ViewportManager } from "./viewport-manager.js";

export type {
  ScreenService,
  ViewportBounds,
  ViewportBoundsProvider,
  ViewportPixels,
  ViewportScreenInfo,
};

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

  get devicePixelRatio(): number {
    return this._dpr;
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

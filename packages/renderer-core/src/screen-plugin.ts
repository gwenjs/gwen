/**
 * @file ScreenPlugin — tracks container size and computes per-viewport pixel dimensions.
 *
 * Registered automatically by `@gwenjs/app` (like `gwen:viewports`).
 * Can also be installed manually via `engine.use(ScreenPlugin())`.
 *
 * @example Zero-config browser usage (registered automatically)
 * ```ts
 * // gwen.config.ts — nothing needed, ScreenPlugin auto-detects ResizeObserver
 * export default defineConfig({})
 * ```
 *
 * @example Node.js / server
 * ```ts
 * import { StaticSizeProvider } from '@gwenjs/renderer-core'
 * export default defineConfig({
 *   screen: { sizeProvider: StaticSizeProvider({ width: 1920, height: 1080 }) }
 * })
 * ```
 */

import { definePlugin } from "@gwenjs/kit/plugin";
import { getOrCreateScreenService } from "./get-or-create-screen-service.js";
import { BrowserSizeProvider, StaticSizeProvider } from "./screen-size-providers.js";
import type { ScreenSizeProvider } from "./screen-size-providers.js";
import { ScreenErrorCodes } from "./screen-errors.js";

/** Options accepted by `ScreenPlugin`. */
export interface ScreenPluginOptions {
  /**
   * Custom size provider. When absent, `ScreenPlugin` auto-detects the environment:
   * - Browser with `ResizeObserver`: uses `BrowserSizeProvider()` on `document.documentElement`.
   * - No DOM / no `ResizeObserver`: logs a warning and uses `StaticSizeProvider({ width: 0, height: 0 })`.
   */
  sizeProvider?: ScreenSizeProvider;
}

/**
 * Runtime plugin that tracks the game container size and exposes per-viewport
 * pixel dimensions and world-space bounds through `useScreen()`.
 *
 * @example
 * ```ts
 * // Installed automatically — you do not need to call this manually.
 * await engine.use(ScreenPlugin())
 * ```
 */
export const ScreenPlugin = definePlugin((opts: ScreenPluginOptions = {}) => ({
  name: "gwen:screen",
  setup(engine) {
    const log = engine.logger.child("renderer-core:screen");
    const service = getOrCreateScreenService(engine);

    // Determine size provider
    let sizeProvider: ScreenSizeProvider;
    if (opts.sizeProvider) {
      sizeProvider = opts.sizeProvider;
    } else if (typeof ResizeObserver !== "undefined" && typeof document !== "undefined") {
      sizeProvider = BrowserSizeProvider();
    } else {
      log.warn(
        `[${ScreenErrorCodes.ResizeObserverNotAvailable}] ` +
          "No DOM and no sizeProvider configured. " +
          "Screen size will be { width: 0, height: 0 }. " +
          "Configure screen.sizeProvider in gwen.config.ts for non-browser environments. " +
          "See: https://gwenengine.dev/docs/screen#node",
      );
      sizeProvider = StaticSizeProvider({ width: 0, height: 0 });
    }

    engine.hooks.hook("engine:init", () => {
      // Apply initial size
      const { width, height } = sizeProvider.getSize();
      service.setContainerSize(width, height);

      // Subscribe to resize events — cleanup on engine:stop
      const cleanup = sizeProvider.subscribe((w, h) => {
        service.setContainerSize(w, h);
      });
      engine.hooks.hook("engine:stop", () => {
        cleanup();
      });
    });

    // Refresh pixels when a new viewport is added (may have been called before engine:init)
    engine.hooks.hook("viewport:add", (_payload) => {
      const { width, height } = sizeProvider.getSize();
      service.setContainerSize(width, height);
    });

    // Clean up tracked info when a viewport is removed
    engine.hooks.hook("viewport:remove", ({ id }) => {
      service.removeViewport(id);
    });

    // Compute world bounds each frame — after CameraSystem writes CameraState in onAfterUpdate
    engine.hooks.hook("engine:afterTick", () => {
      service.computeAllBounds();
    });
  },
}));

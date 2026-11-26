/**
 * @file RenderHostPlugin — owns the viewport, camera and layer services.
 *
 * Installed by the bootstrap under the name `gwen:viewports`, before `gwen:screen` and
 * before every renderer or camera plugin. A renderer plugin only registers its service
 * with `engine.inject('layerManager').register(service)`. The host binds the root,
 * mounts every registered renderer once (also one registered after start), reports a
 * renderer whose `mount()` throws on `engine.errors`, and unmounts everything at
 * `engine.stop()`.
 *
 * @example
 * ```ts
 * await engine.use(RenderHostPlugin({ container: document.getElementById('game')! }))
 * await engine.use(ScreenPlugin())
 * ```
 */

import type { GwenEngine } from "@gwenjs/core";
import { definePlugin, type GwenPluginDeclaration } from "@gwenjs/kit/plugin";
import type { ViewportRegion } from "./camera-types.js";
import { createManagerServices } from "./create-manager-services.js";
import type { LayerManager } from "./layer-manager.js";

/** Options accepted by `RenderHostPlugin`. */
export interface RenderHostOptions {
  /**
   * Element the renderers mount into. Defaults to `document.body`.
   * With no container and no `document`, nothing is mounted.
   */
  container?: HTMLElement | undefined;
  /** Viewports to register at `engine:init`. Absent or empty registers a full-screen `main`. */
  viewports?: Record<string, ViewportRegion> | undefined;
}

const DEFAULT_MAIN: ViewportRegion = { x: 0, y: 0, width: 1, height: 1 };

const renderHostDeclaration: GwenPluginDeclaration<
  RenderHostOptions,
  "viewportManager" | "cameraManager" | "layerManager"
> = {
  provides: ["viewportManager", "cameraManager", "layerManager"],
  options: { defaults: {} },
};

/**
 * Plugin that provides `viewportManager`, `cameraManager` and `layerManager` and drives
 * the renderers registered on `layerManager`.
 *
 * Browser-safe: no Node.js dependency. It is a bootstrap plugin, never a `PluginDeclaration`,
 * because `container` is an element and cannot be serialised.
 */
export const RenderHostPlugin = definePlugin(renderHostDeclaration, (opts) => {
  let layers: LayerManager | undefined;
  return {
    name: "gwen:viewports",
    setup(engine: GwenEngine) {
      const managers = createManagerServices(engine);
      engine.provide("viewportManager", managers.viewportManager);
      engine.provide("cameraManager", managers.cameraManager);
      engine.provide("layerManager", managers.layerManager);
      const host = managers.layerManager;
      layers = host;
      if (__GWEN_DEV__ && engine.debug) host.enableStats();
      engine.hooks.hook("engine:init", () => {
        const entries = Object.entries(opts.viewports ?? {});
        if (entries.length === 0) {
          managers.viewportManager.set("main", DEFAULT_MAIN);
        } else {
          for (const [id, region] of entries) managers.viewportManager.set(id, region);
        }
        const root =
          opts.container ?? (typeof document === "undefined" ? undefined : document.body);
        if (root === undefined) return;
        host.bindRoot(root);
        host.mount();
      });
    },
    teardown() {
      layers?.dispose();
      layers = undefined;
    },
  };
});

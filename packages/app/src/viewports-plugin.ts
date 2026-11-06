/**
 * @file viewports-plugin — provides the shared viewport, camera and layer managers.
 *
 * Created by GwenApp.setupModules() when a resolved config is processed.
 * Registered before all module plugins so the managers exist when camera and
 * renderer plugins run their setup.
 *
 * Behaviour:
 * - Provides `viewportManager`, `cameraManager` and `layerManager`.
 * - If config.viewports is set → registers those viewports on engine:init.
 * - If config.viewports is absent or empty → registers a default fullscreen
 *   'main' viewport on engine:init.
 *
 * This is browser-safe. No Node.js dependencies.
 */

import { definePlugin } from "@gwenjs/kit/plugin";
import type { GwenEngine } from "@gwenjs/core";
import { createManagerServices } from "@gwenjs/renderer-core";
import type { ViewportRegion } from "@gwenjs/renderer-core";

const DEFAULT_MAIN: ViewportRegion = { x: 0, y: 0, width: 1, height: 1 };

/**
 * Factory that returns a `GwenPlugin` initialising the `ViewportManager`
 * with the supplied viewport map (or a default fullscreen 'main' if the
 * map is absent/empty).
 *
 * @internal — called by GwenApp.setupModules(), not by end-users.
 */
export function createViewportsPlugin(viewports?: Record<string, ViewportRegion>) {
  const entries: [string, ViewportRegion][] = Object.entries(viewports ?? {});

  return definePlugin({ provides: ["viewportManager", "cameraManager", "layerManager"] }, () => ({
    name: "gwen:viewports",
    setup(engine: GwenEngine) {
      const managers = createManagerServices(engine);
      engine.provide("viewportManager", managers.viewportManager);
      engine.provide("cameraManager", managers.cameraManager);
      engine.provide("layerManager", managers.layerManager);
      const vm = managers.viewportManager;
      engine.hooks.hook("engine:init", () => {
        if (entries.length === 0) {
          vm.set("main", DEFAULT_MAIN);
        } else {
          for (const [id, region] of entries) {
            vm.set(id, region);
          }
        }
      });
    },
  }))();
}

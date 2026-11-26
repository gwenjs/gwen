// packages/renderer-core/src/get-or-create-viewport-manager.ts
/**
 * @file createViewportManager — build the viewport manager of the render host.
 *
 * The render host (`gwen:viewports`) creates the manager. Plugin setup code reads it with
 * `engine.inject('viewportManager')`. The file keeps its name because `oxlint.json`
 * allow-lists this exact path for the `callHook` cast below.
 */

import type { GwenEngine } from "@gwenjs/core";
import { reportRejectedHook } from "@gwenjs/core/internal";
import { ViewportManagerImpl } from "./viewport-manager.js";
import type { ViewportManager } from "./viewport-manager.js";

/** Build a viewport manager wired to this engine's hook bus. Not a package export. */
export function createViewportManager(engine: GwenEngine): ViewportManager {
  return new ViewportManagerImpl((event, payload) => {
    reportRejectedHook(
      engine,
      "@gwenjs/renderer-core",
      event,
      (engine.hooks.callHook as (name: string, ...args: unknown[]) => unknown)(event, payload), // boundary: the manager hands over a plain string event and an unknown payload, while callHook accepts only the keys of the hook map and each hook's own arguments
    );
  });
}

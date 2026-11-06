// packages/renderer-core/src/get-or-create-viewport-manager.ts
/**
 * @file getOrCreateViewportManager — read the viewport service.
 *
 * `gwen:viewports` creates the manager. Plugin setup code reads it here.
 * The {@link createViewportManager} helper keeps the `callHook` cast in this file.
 *
 * @example
 * ```ts
 * setup(engine) {
 *   const viewports = getOrCreateViewportManager(engine)
 *   viewports.set('main', { x: 0, y: 0, width: 1, height: 1 })
 * }
 * ```
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

/**
 * Read the shared {@link ViewportManager} declared by `gwen:viewports`.
 *
 * Reads the service declared by gwen:viewports. Does not create it. Removal is #230 G2's.
 */
export function getOrCreateViewportManager(engine: GwenEngine): ViewportManager {
  return engine.inject("viewportManager");
}

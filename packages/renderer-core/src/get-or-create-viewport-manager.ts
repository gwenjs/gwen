// packages/renderer-core/src/get-or-create-viewport-manager.ts
/**
 * @file getOrCreateViewportManager — lazy singleton factory.
 *
 * Plugin setup code calls this instead of `new ViewportManagerImpl()`.
 * Wires `engine.hooks.callHook` so viewport changes propagate as engine events.
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
import { ViewportManagerImpl } from "./viewport-manager.js";
import type { ViewportManager } from "./viewport-manager.js";
import type { ViewportRegion } from "./camera-types.js";

declare module "@gwenjs/core" {
  interface GwenProvides {
    viewportManager: ViewportManager;
  }
  interface GwenRuntimeHooks {
    "viewport:add": (payload: { id: string; region: ViewportRegion }) => void;
    "viewport:resize": (payload: { id: string; region: ViewportRegion }) => void;
    "viewport:remove": (payload: { id: string }) => void;
  }
}

/**
 * Return the shared {@link ViewportManager} for this engine instance, creating it
 * if it does not yet exist.
 */
export function getOrCreateViewportManager(engine: GwenEngine): ViewportManager {
  const existing = engine.tryInject("viewportManager");
  if (existing) return existing;

  const manager = new ViewportManagerImpl((event, payload) => {
    // fire-and-forget — viewport hooks are synchronous listeners only
    (engine.hooks.callHook as (name: string, ...args: unknown[]) => void)(event, payload);
  });
  engine.provide("viewportManager", manager);
  return manager;
}

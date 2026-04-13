/**
 * @file getOrCreateScreenService — lazy singleton factory.
 *
 * Plugin setup code calls this to access or create the shared `ScreenService`.
 * Game code should use `useScreen()` instead.
 *
 * @example
 * ```ts
 * // In a camera plugin setup(engine):
 * import { getOrCreateScreenService } from '@gwenjs/renderer-core'
 *
 * setup(engine) {
 *   const screen = getOrCreateScreenService(engine)
 *   screen.registerBoundsProvider(myProvider)
 * }
 * ```
 */

import type { GwenEngine } from "@gwenjs/core";
import { getOrCreateViewportManager } from "./get-or-create-viewport-manager.js";
import { ScreenServiceImpl } from "./screen-service.js";
import type { ScreenService } from "./screen-service.js";

declare module "@gwenjs/core" {
  interface GwenProvides {
    /** The shared ScreenService for this engine instance. Use `useScreen()` in game code. */
    screenService: ScreenService;
  }
}

/**
 * Return the shared {@link ScreenService} for this engine instance, creating it if needed.
 *
 * Ensures `ViewportManager` also exists (creates it if absent).
 * For use inside plugin `setup(engine)` functions only.
 * Game code should use `useScreen()` instead.
 *
 * @param engine - The current engine instance.
 * @returns The shared `ScreenService`.
 */
export function getOrCreateScreenService(engine: GwenEngine): ScreenService {
  const existing = engine.tryInject("screenService");
  if (existing) return existing;

  const vm = getOrCreateViewportManager(engine);
  const log = engine.logger.child("renderer-core:screen");
  const service = new ScreenServiceImpl(log, vm);
  engine.provide("screenService", service);
  return service;
}

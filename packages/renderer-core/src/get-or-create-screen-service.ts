/**
 * @file getOrCreateScreenService — read the screen service.
 *
 * `gwen:screen` creates the service. Plugin setup code reads it here.
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

import type { GwenEngineBase } from "@gwenjs/schema";
import type { ScreenService } from "./screen-service.js";

/**
 * Read the shared {@link ScreenService} declared by `gwen:screen`.
 *
 * For use inside plugin `setup(engine)` functions only.
 * Game code should use `useScreen()` instead.
 *
 * Reads the service declared by gwen:screen. Does not create it. Removal is #230 G2's.
 *
 * @param engine - The current engine instance.
 * @returns The shared `ScreenService`.
 */
export function getOrCreateScreenService(engine: GwenEngineBase): ScreenService {
  return engine.inject("screenService");
}

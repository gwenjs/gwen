/**
 * @file createScreenPlugin — initialises ScreenPlugin from gwen.config.ts.
 *
 * Created by GwenApp.setupModules() when a resolved config is processed.
 * Registered before all module plugins (after gwen:viewports) so pixel dimensions
 * are available when camera and renderer plugins run their engine:init hooks.
 *
 * This is browser-safe. No Node.js dependencies.
 */

import { ScreenPlugin } from "@gwenjs/renderer-core";
import type { ScreenSizeProvider } from "@gwenjs/renderer-core";

/**
 * Factory that returns a `GwenPlugin` initialising `ScreenPlugin`
 * with the supplied options (or auto-detected defaults if absent).
 *
 * @internal — called by GwenApp.setupModules(), not by end-users.
 */
export function createScreenPlugin(opts?: { sizeProvider?: ScreenSizeProvider }) {
  return ScreenPlugin(opts ?? {});
}

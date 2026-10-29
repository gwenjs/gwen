/**
 * @file GWEN Module for @gwenjs/renderer-core.
 *
 * Register by package name in `gwen.config.ts`. The app installs the screen
 * plugin from the `screen` key (`packages/app/src/app.ts:186`).
 *
 * ```ts
 * export default defineConfig({
 *   modules: ['@gwenjs/renderer-core'],
 * })
 * ```
 */

import { defineGwenModule } from "@gwenjs/kit/module";

export default defineGwenModule({
  meta: { name: "@gwenjs/renderer-core" },
  async setup(_options, kit) {
    kit.addAutoImports([
      { name: "useScreen", from: "@gwenjs/renderer-core" },
      { name: "useCameraManager", from: "@gwenjs/renderer-core" },
      { name: "useViewportManager", from: "@gwenjs/renderer-core" },
    ]);
  },
});

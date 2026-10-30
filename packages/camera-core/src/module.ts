/**
 * @file GWEN Module for @gwenjs/camera-core.
 *
 * Register by package name in `gwen.config.ts`.
 *
 * ```ts
 * export default defineConfig({
 *   modules: ['@gwenjs/camera-core'],
 * })
 * ```
 */

import { defineGwenModule } from "@gwenjs/kit/module";

export default defineGwenModule({
  meta: { name: "@gwenjs/camera-core" },
  async setup(_options, kit) {
    kit.addPlugin({ src: "@gwenjs/camera-core", export: "CameraCorePlugin" });

    kit.addAutoImports([
      { name: "useCamera", from: "@gwenjs/camera-core" },
      { name: "useXRCamera", from: "@gwenjs/camera-core" },
    ]);
  },
});

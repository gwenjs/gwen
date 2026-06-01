/**
 * @file GWEN Module for @gwenjs/renderer-core.
 *
 * Register by package name in `gwen.config.ts`. Options go at the top-level
 * `screen` key — TypeScript infers them via `GwenModuleOptions` augmentation.
 *
 * ```ts
 * export default defineConfig({
 *   modules: ['@gwenjs/renderer-core'],
 *   screen: { sizeProvider: StaticSizeProvider({ width: 1920, height: 1080 }) },
 * })
 * ```
 */

import { defineGwenModule } from "@gwenjs/kit/module";
import { ScreenPlugin, type ScreenPluginOptions } from "./screen-plugin";

// @ts-expect-error augmenting @gwenjs/app (intentional, activated at app build time)
declare module "@gwenjs/app" {
  interface GwenModuleOptions {
    /** Options for `@gwenjs/renderer-core`. Configure the screen size provider. */
    screen?: ScreenPluginOptions;
  }
}

export default defineGwenModule<ScreenPluginOptions>({
  meta: { name: "@gwenjs/renderer-core", configKey: "screen" },
  async setup(options, kit) {
    kit.addPlugin(ScreenPlugin(options));

    kit.addAutoImports([
      { name: "useScreen", from: "@gwenjs/renderer-core" },
      { name: "useCameraManager", from: "@gwenjs/renderer-core" },
      { name: "useViewportManager", from: "@gwenjs/renderer-core" },
    ]);
  },
});

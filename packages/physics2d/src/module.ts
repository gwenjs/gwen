/**
 * @file GWEN Module for @gwenjs/physics2d.
 *
 * Register by package name in `gwen.config.ts`. Options go at the top-level
 * `physics2d` key — TypeScript infers them via `GwenModuleOptions` augmentation.
 *
 * ```ts
 * export default defineConfig({
 *   modules: ['@gwenjs/physics2d'],
 *   physics2d: { gravity: -9.81 },
 * })
 * ```
 */

import { defineGwenModule } from "@gwenjs/kit/module";
import { PHYSICS2D_DEFAULTS, checkPhysics2DConfig } from "./config";
import { physics2dVitePlugin } from "./vite-plugin";
import type { Physics2DConfig } from "./types";

/**
 * GWEN module for the Physics 2D plugin.
 *
 * When installed via `gwen add @gwenjs/physics2d`, this module:
 * 1. Registers the physics2d runtime plugin.
 * 2. Adds `usePhysics2D`, `useRigidBody`, `useCollider` as auto-imports.
 * 3. Adds the physics2d Vite plugin.
 */
declare module "@gwenjs/schema" {
  interface GwenModuleOptions {
    /** Options for `@gwenjs/physics2d`. Configure gravity and physics quality. */
    physics2d?: Physics2DConfig;
  }
}

export default defineGwenModule<Physics2DConfig>({
  meta: { name: "@gwenjs/physics2d", configKey: "physics2d" },
  defaults: PHYSICS2D_DEFAULTS,
  validate: checkPhysics2DConfig,
  async setup(options, kit) {
    kit.addPlugin({ src: "@gwenjs/physics2d", export: "Physics2DPlugin", options });
    const viteDebug = options.vite?.debug;
    kit.addVitePlugin(
      physics2dVitePlugin(
        viteDebug === undefined ? {} : { debug: viteDebug },
      ) as unknown as import("@gwenjs/kit").VitePlugin,
    );

    kit.addAutoImports([
      { name: "usePhysics2D", from: "@gwenjs/physics2d" },
      { name: "useRigidBody", from: "@gwenjs/physics2d" },
      { name: "useCollider", from: "@gwenjs/physics2d" },
      // RFC-04 additions:
      { name: "useStaticBody", from: "@gwenjs/physics2d" },
      { name: "useDynamicBody", from: "@gwenjs/physics2d" },
      { name: "useBoxCollider", from: "@gwenjs/physics2d" },
      { name: "useSphereCollider", from: "@gwenjs/physics2d" },
      { name: "useCapsuleCollider", from: "@gwenjs/physics2d" },
      { name: "defineLayers", from: "@gwenjs/physics2d" },
      { name: "onContact", from: "@gwenjs/physics2d" },
      { name: "onSensorEnter", from: "@gwenjs/physics2d" },
      { name: "onSensorExit", from: "@gwenjs/physics2d" },
      { name: "useShape", from: "@gwenjs/physics2d" },
      { name: "useKinematicBody", from: "@gwenjs/physics2d" },
    ]);
  },
});

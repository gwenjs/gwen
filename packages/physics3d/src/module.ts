/**
 * @file GWEN Module for @gwenjs/physics3d.
 *
 * Register by package name in `gwen.config.ts`. Options go at the top-level
 * `physics3d` key — TypeScript infers them via `GwenModuleOptions` augmentation.
 *
 * ```ts
 * export default defineConfig({
 *   modules: ['@gwenjs/physics3d'],
 *   physics3d: { gravity: { x: 0, y: -9.81, z: 0 } },
 * })
 * ```
 */

import { defineGwenModule } from "@gwenjs/kit/module";
import type { VitePlugin } from "@gwenjs/kit";
import type { Physics3DConfig } from "./types";
import { physics3dVitePlugin, type GwenPhysics3DPluginOptions } from "./vite-plugin";

/**
 * GWEN module for the Physics 3D plugin.
 */

declare module "@gwenjs/schema" {
  interface GwenModuleOptions {
    /** Options for `@gwenjs/physics3d`. Configure gravity and physics quality. */
    physics3d?: Physics3DConfig;
  }
}

export default defineGwenModule<Physics3DConfig>({
  meta: { name: "@gwenjs/physics3d", configKey: "physics3d" },
  defaults: {
    gravity: { x: 0, y: -9.81, z: 0 },
  },
  async setup(options, kit) {
    kit.addPlugin({ src: "@gwenjs/physics3d", export: "Physics3DPlugin", options });

    kit.addAutoImports([
      { name: "usePhysics3D", from: "@gwenjs/physics3d" },
      { name: "useStaticBody", from: "@gwenjs/physics3d" },
      { name: "useDynamicBody", from: "@gwenjs/physics3d" },
      { name: "useBoxCollider", from: "@gwenjs/physics3d" },
      { name: "useSphereCollider", from: "@gwenjs/physics3d" },
      { name: "useCapsuleCollider", from: "@gwenjs/physics3d" },
      { name: "useMeshCollider", from: "@gwenjs/physics3d" },
      { name: "useConvexCollider", from: "@gwenjs/physics3d" },
      { name: "defineLayers", from: "@gwenjs/physics3d" },
      { name: "onContact", from: "@gwenjs/physics3d" },
      { name: "onSensorEnter", from: "@gwenjs/physics3d" },
      { name: "onSensorExit", from: "@gwenjs/physics3d" },
      { name: "useKinematicBody", from: "@gwenjs/physics3d" },
      { name: "useCompoundCollider", from: "@gwenjs/physics3d" },
      { name: "useHeightfieldCollider", from: "@gwenjs/physics3d" },
      { name: "useBulkStaticBoxes", from: "@gwenjs/physics3d" },
      { name: "useRaycast", from: "@gwenjs/physics3d" },
      { name: "useShapeCast", from: "@gwenjs/physics3d" },
      { name: "useOverlap", from: "@gwenjs/physics3d" },
      { name: "useJoint", from: "@gwenjs/physics3d" },
    ]);

    const viteOptions: GwenPhysics3DPluginOptions = {
      ...(options.vite?.bvhPrebake !== undefined ? { bvhPrebake: options.vite.bvhPrebake } : {}),
      ...(options.vite?.debug !== undefined ? { debug: options.vite.debug } : {}),
    };
    kit.addVitePlugin(physics3dVitePlugin(viteOptions) as unknown as VitePlugin);
  },
});

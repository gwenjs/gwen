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

import { definePhysicsModule } from "@gwenjs/physics-core/module";
import type { Physics3DConfig } from "./types";
import { physics3dVitePlugin, type GwenPhysics3DPluginOptions } from "./vite-plugin";
import type {} from "./augment";

export { physics3dVitePlugin };
export type { GwenPhysics3DPluginOptions };

/**
 * GWEN module for the Physics 3D plugin.
 */

export default definePhysicsModule<Physics3DConfig>({
  name: "@gwenjs/physics3d",
  configKey: "physics3d",
  defaults: {
    gravity: { x: 0, y: -9.81, z: 0 },
  },
  plugin: { src: "@gwenjs/physics3d", export: "Physics3DPlugin" },
  vitePlugin: (options) => {
    const viteOptions: GwenPhysics3DPluginOptions =
      options.vite?.bvhPrebake !== undefined ? { bvhPrebake: options.vite.bvhPrebake } : {};
    return { ...physics3dVitePlugin(viteOptions) };
  },
  autoImports: [
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
  ],
});

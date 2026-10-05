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
import { definePluginTypes } from "@gwenjs/kit/plugin";
import type { VitePlugin } from "@gwenjs/kit";
import { Physics3DPlugin } from "./index";
import type { Physics3DConfig } from "./types";
import { physics3dVitePlugin, type GwenPhysics3DPluginOptions } from "./vite-plugin";
import { setIf } from "./set-if";

/**
 * GWEN module for the Physics 3D plugin.
 */

// @ts-expect-error augmenting @gwenjs/app (intentional, activated at app build time)
declare module "@gwenjs/app" {
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
    kit.addPlugin(Physics3DPlugin(options));

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

    const viteOptions: GwenPhysics3DPluginOptions = {};
    setIf((value) => {
      viteOptions.bvhPrebake = value;
    }, options.vite?.bvhPrebake);
    setIf((value) => {
      viteOptions.debug = value;
    }, options.vite?.debug);
    kit.addVitePlugin(physics3dVitePlugin(viteOptions) as unknown as VitePlugin);

    kit.addTypeTemplate({
      filename: "physics3d.d.ts",
      getContents: () =>
        definePluginTypes({
          imports: ["import type { Physics3DAPI } from '@gwenjs/physics3d'"],
          provides: { physics3d: "Physics3DAPI" },
          hooks: {
            "physics3d:step": "(stepDt: number) => void",
            "physics3d:collisionStart": "(entityA: EntityId, entityB: EntityId) => void",
            "physics3d:collisionEnd": "(entityA: EntityId, entityB: EntityId) => void",
          },
        }),
    });
  },
});

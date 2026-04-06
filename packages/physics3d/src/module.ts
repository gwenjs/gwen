/**
 * @file GWEN Module for @gwenjs/physics3d.
 *
 * Default export — register this in `modules` inside `gwen.config.ts`:
 *
 * ```ts
 * import physics3d from '@gwenjs/physics3d/module'
 * export default defineConfig({ modules: [physics3d()] })
 * ```
 */

import { defineGwenModule, definePluginTypes, type VitePlugin } from '@gwenjs/kit';
import { Physics3DPlugin } from './index';
import type { Physics3DConfig } from './types';
import { physics3dVitePlugin } from './vite-plugin';

/**
 * GWEN module for the Physics 3D plugin.
 */
export default defineGwenModule<Physics3DConfig>({
  meta: { name: '@gwenjs/physics3d' },
  defaults: {
    gravity: { x: 0, y: -9.81, z: 0 },
  },
  async setup(options, kit) {
    kit.addPlugin(Physics3DPlugin(options));

    kit.addAutoImports([
      { name: 'usePhysics3D', from: '@gwenjs/physics3d' },
      { name: 'useStaticBody', from: '@gwenjs/physics3d' },
      { name: 'useDynamicBody', from: '@gwenjs/physics3d' },
      { name: 'useBoxCollider', from: '@gwenjs/physics3d' },
      { name: 'useSphereCollider', from: '@gwenjs/physics3d' },
      { name: 'useCapsuleCollider', from: '@gwenjs/physics3d' },
      { name: 'useMeshCollider', from: '@gwenjs/physics3d' },
      { name: 'useConvexCollider', from: '@gwenjs/physics3d' },
      { name: 'defineLayers', from: '@gwenjs/physics3d' },
      { name: 'onContact', from: '@gwenjs/physics3d' },
      { name: 'onSensorEnter', from: '@gwenjs/physics3d' },
      { name: 'onSensorExit', from: '@gwenjs/physics3d' },
    ]);

    kit.addVitePlugin(physics3dVitePlugin() as unknown as VitePlugin);

    kit.addTypeTemplate({
      filename: 'physics3d.d.ts',
      getContents: () =>
        definePluginTypes({
          imports: ["import type { Physics3DAPI } from '@gwenjs/physics3d'"],
          provides: { physics3d: 'Physics3DAPI' },
          hooks: {
            'physics3d:step': '(stepDt: number) => void',
            'physics3d:collisionStart': '(entityA: EntityId, entityB: EntityId) => void',
            'physics3d:collisionEnd': '(entityA: EntityId, entityB: EntityId) => void',
          },
        }),
    });
  },
});

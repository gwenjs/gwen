/**
 * @file GWEN Module for @gwenjs/physics2d.
 *
 * Default export — register this in `modules` inside `gwen.config.ts`:
 *
 * ```ts
 * import physics2d from '@gwenjs/physics2d/module'
 * // or via top-level re-export:
 * import physics2d from '@gwenjs/physics2d'
 *
 * export default defineConfig({ modules: [physics2d()] })
 * ```
 */

import { defineGwenModule, definePluginTypes } from '@gwenjs/kit';
import { Physics2DPlugin } from './plugin/index';
import { physics2dVitePlugin } from './vite-plugin';
import type { Physics2DConfig } from './types';

/**
 * GWEN module for the Physics 2D plugin.
 *
 * When installed via `gwen add @gwenjs/physics2d`, this module:
 * 1. Registers the physics2d runtime plugin.
 * 2. Adds `usePhysics2D`, `useRigidBody`, `useCollider` as auto-imports.
 * 3. Generates `.gwen/types/physics2d.d.ts` with typed service/hook declarations.
 */
export default defineGwenModule<Physics2DConfig>({
  meta: { name: '@gwenjs/physics2d' },
  defaults: {
    gravity: -9.81,
    gravityX: 0,
  },
  async setup(options, kit) {
    kit.addPlugin(Physics2DPlugin(options));
    kit.addVitePlugin(physics2dVitePlugin() as unknown as import('@gwenjs/kit').VitePlugin);

    kit.addAutoImports([
      { name: 'usePhysics2D', from: '@gwenjs/physics2d' },
      { name: 'useRigidBody', from: '@gwenjs/physics2d' },
      { name: 'useCollider', from: '@gwenjs/physics2d' },
      // RFC-04 additions:
      { name: 'useStaticBody', from: '@gwenjs/physics2d' },
      { name: 'useDynamicBody', from: '@gwenjs/physics2d' },
      { name: 'useBoxCollider', from: '@gwenjs/physics2d' },
      { name: 'useSphereCollider', from: '@gwenjs/physics2d' },
      { name: 'useCapsuleCollider', from: '@gwenjs/physics2d' },
      { name: 'defineLayers', from: '@gwenjs/physics2d' },
      { name: 'onContact', from: '@gwenjs/physics2d' },
      { name: 'onSensorEnter', from: '@gwenjs/physics2d' },
      { name: 'onSensorExit', from: '@gwenjs/physics2d' },
      { name: 'useShape', from: '@gwenjs/physics2d' },
    ]);

    kit.addTypeTemplate({
      filename: 'physics2d.d.ts',
      getContents: () =>
        definePluginTypes({
          imports: [
            "import type { Physics2DAPI, CollisionContact, CollisionEventsBatch, SensorState } from '@gwenjs/physics2d'",
          ],
          provides: { physics2d: 'Physics2DAPI' },
          hooks: {
            'physics:collision': '(contacts: ReadonlyArray<CollisionContact>) => void',
            'physics:collision:batch': '(batch: Readonly<CollisionEventsBatch>) => void',
            'physics:sensor:changed':
              '(entityId: EntityId, sensorId: number, state: SensorState) => void',
          },
        }),
    });
  },
});

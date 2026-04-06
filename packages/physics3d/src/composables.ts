/**
 * @file Composables for @gwenjs/physics3d.
 *
 * Must be called inside an active engine context:
 * inside `defineSystem()`, `engine.run(fn)`, or a plugin lifecycle hook.
 */

import { useEngine, GwenPluginNotFoundError } from '@gwenjs/core';
import type { Physics3DAPI } from './types';
import './augment';

/**
 * Returns the Physics 3D API service registered by `physics3dPlugin()`.
 *
 * @returns The {@link Physics3DAPI} service instance.
 * @throws {GwenPluginNotFoundError} If `physics3dPlugin()` is not registered.
 *
 * @example
 * ```typescript
 * export const gravitySystem = defineSystem(() => {
 *   const physics = usePhysics3D()
 *   onUpdate((dt) => {
 *     physics.applyForce(entityId, 0, -9.81 * dt, 0)
 *   })
 * })
 * ```
 */
export function usePhysics3D(): Physics3DAPI {
  const engine = useEngine();
  const service = engine.tryInject('physics3d');
  if (service) return service;
  throw new GwenPluginNotFoundError({
    pluginName: '@gwenjs/physics3d',
    hint: 'Call engine.use(physics3dPlugin()) before starting the engine.',
    docsUrl: 'https://gwenengine.dev/plugins/physics3d',
  });
}

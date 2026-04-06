/**
 * @file RFC-009 — GwenProvides, GwenRuntimeHooks and GwenPrefabExtensions
 * augmentations for @gwenjs/physics2d.
 *
 * This file contains only TypeScript declaration merging — no runtime code.
 * Importing any symbol from `@gwenjs/physics2d` automatically augments
 * `@gwenjs/core` with typed physics service keys, hooks and prefab extensions.
 */

import type { Physics2DAPI, Physics2DPluginHooks, Physics2DPrefabExtension } from './types';

declare module '@gwenjs/core' {
  /**
   * Physics 2D service slot in the engine's provide/inject registry.
   * Available after `engine.use(physics2dPlugin())` completes setup.
   *
   * @example
   * ```typescript
   * const api = engine.inject('physics2d') // typed as Physics2DAPI
   * ```
   */
  interface GwenProvides {
    physics2d: Physics2DAPI;
  }

  /**
   * Physics 2D runtime hooks augmenting the engine hook bus.
   *
   * @example
   * ```typescript
   * engine.hooks.hook('physics:collision', (contacts) => { … })
   * engine.hooks.hook('physics:sensor:changed', (entityId, sensorId, state) => { … })
   * ```
   */
  interface GwenRuntimeHooks extends Physics2DPluginHooks {}
}

declare global {
  /**
   * Physics 2D prefab extension — enables typed `extensions.physics` blocks
   * inside `definePrefab({ extensions: { physics: { … } } })`.
   */
  interface GwenPrefabExtensions {
    physics?: Physics2DPrefabExtension;
  }
}

// Ensure this file is treated as a module (required for declaration merging).
export {};

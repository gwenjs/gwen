/**
 * @file RFC-009 — GwenProvides, GwenRuntimeHooks and GwenPrefabExtensions
 * augmentations for @gwenjs/physics2d.
 *
 * This file contains only TypeScript declaration merging — no runtime code.
 * Importing any symbol from `@gwenjs/physics2d` automatically augments
 * `@gwenjs/schema` with the physics service key, the runtime hooks and
 * the prefab extension.
 */

import type { Physics2DAPI, Physics2DPluginHooks, Physics2DPrefabExtension } from "./types";

/**
 * Physics 2D service slot in the engine's provide/inject registry.
 * Available after `engine.use(physics2dPlugin())` completes setup.
 *
 * @example
 * ```typescript
 * const api = engine.inject('physics2d') // typed as Physics2DAPI
 * ```
 */
export interface Physics2DProvides {
  physics2d: Physics2DAPI;
}

declare module "@gwenjs/schema" {
  interface GwenProvides {
    physics2d: Physics2DProvides["physics2d"];
  }

  /**
   * Physics 2D runtime hooks augmenting the engine hook bus.
   *
   * @example
   * ```typescript
   * engine.hooks.hook('physics:collision', (contacts) => { … })
   * engine.hooks.hook('physics:sensor:changed', (entityId, sensorId, state) => { … })
   * engine.hooks.hook('physics2d:body-disabled', ({ entity, reason }) => { … })
   * ```
   */
  interface GwenRuntimeHooks extends Physics2DPluginHooks {}

  /**
   * Physics 2D prefab extension — enables typed `extensions.physics` blocks
   * inside `definePrefab(components, { extensions: { physics: { … } } })`.
   */
  interface GwenPrefabExtensions {
    physics?: Physics2DPrefabExtension;
  }
}

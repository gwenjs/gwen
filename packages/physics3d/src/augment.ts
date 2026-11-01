/**
 * @file GwenProvides and GwenRuntimeHooks augmentations for @gwenjs/physics3d.
 *
 * This file contains only TypeScript declaration merging — no runtime code.
 * Importing any symbol from `@gwenjs/physics3d` automatically augments
 * `@gwenjs/schema` with typed physics service keys and hooks.
 */

import type { Physics3DAPI, Physics3DPluginHooks } from "./types";

declare module "@gwenjs/schema" {
  /**
   * Physics 3D service slot in the engine's provide/inject registry.
   * Available after `engine.use(physics3dPlugin())` completes setup.
   *
   * @example
   * ```typescript
   * const api = engine.inject('physics3d') // typed as Physics3DAPI
   * ```
   */
  interface GwenProvides {
    physics3d: Physics3DAPI;
  }

  /**
   * Physics 3D runtime hooks augmenting the engine hook bus.
   * The names are the hooks the plugin fires.
   *
   * @example
   * ```typescript
   * engine.hooks.hook('physics3d:body-disabled', ({ entity, reason }) => { … })
   * ```
   */
  interface GwenRuntimeHooks extends Physics3DPluginHooks {}
}

export {};

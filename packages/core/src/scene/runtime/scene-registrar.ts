/**
 * @file SceneRegistrar — the service interface for registering plugins with
 * the active scene context.
 *
 * `useActor()` and `useActorPool()` use this service instead of importing
 * directly from `scene-context.ts`, breaking the actor→scene coupling.
 *
 * The scene module provides the service via `engine.provide(SCENE_REGISTRAR_KEY, impl)`.
 *
 * @module
 */

import type { GwenPlugin } from "../../engine/gwen-engine";

/**
 * Service key used with `engine.provide()` and `engine.inject()`.
 * @internal
 */
export const SCENE_REGISTRAR_KEY = "scene:registrar" as const;

/**
 * Plugin registration service provided by the scene module.
 *
 * Consumers (`useActor`, `useActorPool`) call `register()` to declare a plugin
 * dependency on the current scene. The registrar is idempotent — registering
 * the same plugin twice is a no-op (identity check via `===`).
 */
export interface SceneRegistrar {
  /**
   * Register a plugin with the current scene context.
   *
   * Idempotent — registering the same plugin object twice has no effect.
   * Safe to call from inside a `defineScene()` factory or during the
   * `_discover()` pass of a `defineSystem()`.
   *
   * @param plugin - The plugin to register.
   */
  register(plugin: GwenPlugin): void;
}

// Augment GwenProvides so engine.inject('scene:registrar') is fully typed.
declare module "../../engine/gwen-engine.js" {
  interface GwenProvides {
    "scene:registrar": SceneRegistrar;
  }
}

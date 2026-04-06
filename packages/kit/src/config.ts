/**
 * Typed project configuration helper for GWEN plugins.
 *
 * Provides plugin extension-merging utilities and type re-exports.
 * `defineConfig()` lives in `@gwenjs/app` — not here.
 */

import type { GwenOptions } from '@gwenjs/schema';

/**
 * Resolved GWEN project configuration shape.
 *
 * An alias for `GwenOptions` from `@gwenjs/schema`, re-exported here for
 * ergonomic access in CLI tooling and plugin packages that need to read
 * or validate the project config without importing from `@gwenjs/schema` directly.
 *
 * @example
 * ```ts
 * import type { GwenConfig } from '@gwenjs/kit'
 *
 * function printTargetFPS(config: GwenConfig) {
 *   console.log(config.engine?.targetFPS ?? 60)
 * }
 * ```
 *
 * @since 1.0.0
 */
export type { GwenOptions as GwenConfig };

/** Converts a union to an intersection (`A | B` -> `A & B`). */
type UnionToIntersection<U> = (U extends unknown ? (arg: U) => void : never) extends (
  arg: infer I,
) => void
  ? I
  : never;

/** Normalize unresolved unions to an object map. */
type AsObject<T> = T extends object ? T : Record<string, never>;

// ── Extension merging ─────────────────────────────────────────────────────────

/** Extract the prefab extension shape from a plugin (fallback {} if absent). */
type PluginPrefabExt<T> = T extends { extensions?: { prefab?: infer E } }
  ? E extends Record<string, unknown>
    ? E
    : {}
  : {};

/** Extract the scene extension shape from a plugin (fallback {} if absent). */
type PluginSceneExt<T> = T extends { extensions?: { scene?: infer E } }
  ? E extends Record<string, unknown>
    ? E
    : {}
  : {};

/** Extract the UI extension shape from a plugin (fallback {} if absent). */
type PluginUIExt<T> = T extends { extensions?: { ui?: infer E } }
  ? E extends Record<string, unknown>
    ? E
    : {}
  : {};

/**
 * Merges the prefab extension shapes declared by all plugins into a single
 * intersection type.
 *
 * Iterates over the provided `Plugins` tuple and collects every
 * `extensions.prefab` shape. Plugins that do not declare a prefab extension
 * contribute an empty `{}` and are effectively ignored.
 *
 * @typeParam Plugins - A readonly tuple of plugin types (e.g. `typeof plugins`).
 *
 * @example
 * ```ts
 * import type { MergePluginsPrefabExtensions } from '@gwenjs/kit'
 *
 * const plugins = [PhysicsPlugin(), AudioPlugin()] as const
 * type PrefabExtras = MergePluginsPrefabExtensions<typeof plugins>
 * // PrefabExtras = { rigidBody?: RigidBodyOptions } & { audioSource?: AudioSourceOptions }
 * ```
 *
 * @since 1.0.0
 */
export type MergePluginsPrefabExtensions<Plugins extends readonly unknown[]> = AsObject<
  UnionToIntersection<PluginPrefabExt<Plugins[number]>>
>;

/**
 * Merges the scene extension shapes declared by all plugins into a single
 * intersection type.
 *
 * Iterates over the provided `Plugins` tuple and collects every
 * `extensions.scene` shape. Plugins that do not declare a scene extension
 * contribute an empty `{}` and are effectively ignored.
 *
 * @typeParam Plugins - A readonly tuple of plugin types (e.g. `typeof plugins`).
 *
 * @example
 * ```ts
 * import type { MergePluginsSceneExtensions } from '@gwenjs/kit'
 *
 * const plugins = [PhysicsPlugin(), LightingPlugin()] as const
 * type SceneExtras = MergePluginsSceneExtensions<typeof plugins>
 * // SceneExtras = { gravity?: number } & { ambientLight?: string }
 * ```
 *
 * @since 1.0.0
 */
export type MergePluginsSceneExtensions<Plugins extends readonly unknown[]> = AsObject<
  UnionToIntersection<PluginSceneExt<Plugins[number]>>
>;

/**
 * Merges the UI extension shapes declared by all plugins into a single
 * intersection type.
 *
 * Iterates over the provided `Plugins` tuple and collects every
 * `extensions.ui` shape. Plugins that do not declare a UI extension
 * contribute an empty `{}` and are effectively ignored.
 *
 * @typeParam Plugins - A readonly tuple of plugin types (e.g. `typeof plugins`).
 *
 * @example
 * ```ts
 * import type { MergePluginsUIExtensions } from '@gwenjs/kit'
 *
 * const plugins = [HUDPlugin(), DialogPlugin()] as const
 * type UIExtras = MergePluginsUIExtensions<typeof plugins>
 * // UIExtras = { hudSlot?: string } & { dialogTheme?: DialogTheme }
 * ```
 *
 * @since 1.0.0
 */
export type MergePluginsUIExtensions<Plugins extends readonly unknown[]> = AsObject<
  UnionToIntersection<PluginUIExt<Plugins[number]>>
>;

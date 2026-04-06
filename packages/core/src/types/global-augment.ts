/**
 * Global ambient augmentations — enriched by `gwen prepare`.
 *
 * These interfaces are extended by `.gwen/types/*.d.ts` files generated
 * by `gwen prepare` to provide strict plugin-specific types.
 */

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
declare global {
  /**
   * Prefab extension map enriched by `.gwen/gwen.d.ts`.
   *
   * Before prepare: open index signature accepts any plugin key (needed for test code
   * and untyped usage). After prepare: extended with each plugin's prefab extension
   * schema — concrete keys take priority over the index signature.
   *
   * @example
   * ```ts
   * // After gwen prepare — typed automatically from plugins
   * definePrefab({
   *   name: 'Player',
   *   extensions: { physics: { mass: 10 } }, // ✅ typed
   * });
   * ```
   */
  interface GwenPrefabExtensions {
    [key: string]: unknown;
  }

  /**
   * Scene extension map enriched by `.gwen/gwen.d.ts`.
   *
   * Before prepare: open index signature accepts any plugin key.
   * After prepare: extended with each plugin's scene extension schema.
   */
  interface GwenSceneExtensions {
    [key: string]: unknown;
  }

  /**
   * UI extension map enriched by `.gwen/gwen.d.ts`.
   *
   * Before prepare: open index signature accepts any plugin key.
   * After prepare: extended with each plugin's UI extension schema.
   */
  interface GwenUIExtensions {
    [key: string]: unknown;
  }
}

export {};

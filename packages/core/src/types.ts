/**
 * GWEN Engine — public type barrel.
 *
 * All types are defined in focused single-responsibility modules under `./types/`.
 * Import from `@gwenjs/core` as usual — this file re-exports everything.
 *
 * Module map:
 *   types/global-augment.ts  — GwenPrefabExtensions, GwenSceneExtensions, GwenUIExtensions (declare global)
 *   types/entity.ts          — EntityId, ComponentType, ComponentAccessor, Vector2D, Color
 *   types/engine-config.ts   — EngineConfig
 */

export * from './types/global-augment';
export * from './types/entity';
export * from './types/engine-config';

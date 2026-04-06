/**
 * Core ECS prefab primitives.
 *
 * A prefab declares the component layout of an entity upfront, enabling
 * the engine to batch-process all instances using cache-friendly SoA iteration.
 *
 * Prefabs are pure data — they have no lifecycle or behaviour.
 * Use `defineActor` from `@gwenjs/core/scene` to attach behaviour.
 *
 * @example
 * ```typescript
 * import { definePrefab } from '@gwenjs/core'
 *
 * export const EnemyPrefab = definePrefab([
 *   { def: Position, defaults: { x: 0, y: 0 } },
 *   { def: Health,   defaults: { hp: 100 } },
 * ])
 * ```
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * A component entry in a prefab: component definition reference + default values.
 * Kept intentionally generic to avoid coupling to the ECS schema types.
 */
export interface PrefabComponentEntry {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  def: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  defaults: Record<string, any>;
}

/**
 * Defines the memory layout of an entity: a list of components + their default values.
 * Produced by `definePrefab()`.
 */
export interface PrefabDefinition {
  /** Debug name (injected by the Vite transform at build time, else `'anonymous'`). */
  readonly __prefabName__: string;
  /** Declared components, in insertion order. */
  readonly components: PrefabComponentEntry[];
}

// ─── Implementation ───────────────────────────────────────────────────────────

/**
 * Declares the ECS component layout for an entity or actor.
 *
 * Providing a prefab lets GWEN know the component layout at setup time,
 * enabling batched ECS processing (cache-friendly SoA iteration) instead
 * of per-instance tracking.
 *
 * @param components - Component definitions with their default values.
 *
 * @example
 * ```typescript
 * export const EnemyPrefab = definePrefab([
 *   { def: Position, defaults: { x: 0, y: 0 } },
 *   { def: Health,   defaults: { hp: 100 } },
 * ])
 * ```
 */
export function definePrefab(components: PrefabComponentEntry[]): PrefabDefinition {
  return Object.freeze({
    __prefabName__: 'anonymous',
    components: [...components],
  });
}

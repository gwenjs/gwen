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

import type { InferComponent } from "../../schema";
import type { ComponentDef } from "../../system/runtime/define-system";

// ─── Types ────────────────────────────────────────────────────────────────────

type UnionToIntersection<U> = (U extends unknown ? (x: U) => void : never) extends (
  x: infer I,
) => void
  ? I
  : never;

/** One prefab slot per component. Tuple methods stay as they are. */
export type PrefabEntries<E extends readonly ComponentDef[]> = {
  [I in keyof E]: { def: E[I]; defaults: Partial<InferComponent<E[I]>> };
};

/**
 * Flat field bag merged into every component at spawn.
 * Matches the runtime shallow merge of one overrides object into each component.
 * `InferComponent` is not distributive, so the union is split before the intersection.
 */
type InferComponentUnion<D> = D extends ComponentDef ? InferComponent<D> : never;

export type PrefabOverrides<E extends readonly ComponentDef[]> = Partial<
  UnionToIntersection<InferComponentUnion<E[number]>>
>;

/**
 * Defines the memory layout of an entity: a list of components + their default values.
 * Produced by `definePrefab()`.
 */
export interface PrefabDefinition<E extends readonly ComponentDef[]> {
  /** Debug name (injected by the Vite transform at build time, else `'anonymous'`). */
  readonly __prefabName__: string;
  /** Declared components, in insertion order. */
  readonly components: PrefabEntries<E>;
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
export function definePrefab<const E extends readonly ComponentDef[]>(
  components: PrefabEntries<E>,
): PrefabDefinition<E> {
  return Object.freeze({
    __prefabName__: "anonymous",
    components: [...components] as PrefabEntries<E>,
  });
}

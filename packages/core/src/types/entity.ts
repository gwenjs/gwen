import type { EntityId } from "@gwenjs/schema";

/**
 * Entity & component primitive types.
 *
 * Foundational entity types. `entityIndex` throws `GwenError`
 * `CORE:INVALID_ENTITY_ID` when the id is not a bigint.
 */

export { createEntityId, unpackEntityId, entityIndex, entityGeneration } from "@gwenjs/schema";
export type { EntityId, ComponentType } from "@gwenjs/schema";

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * Typed accessor for a single component type.
 * Useful for building higher-level helpers on top of the raw ECS.
 */
export interface ComponentAccessor<T> {
  /**
   * Read the component data for `entityId`.
   * @returns The data, or `undefined` if the entity does not have this component.
   */
  get(entityId: EntityId): T | undefined;

  /**
   * Write (create or overwrite) the component data for `entityId`.
   * @param data New component value.
   */
  set(entityId: EntityId, data: T): void;

  /**
   * Return `true` if `entityId` has this component type.
   */
  has(entityId: EntityId): boolean;

  /**
   * Remove this component from `entityId`.
   * @returns `true` if the component existed and was removed.
   */
  remove(entityId: EntityId): boolean;
}

// ── Math primitives ───────────────────────────────────────────────────────────

/** 2D vector with `x` and `y` coordinates. Used for positions, velocities and sizes. */
export interface Vector2D {
  x: number;
  y: number;
}

/** RGBA color with components in the `[0, 1]` range. */
export interface Color {
  /** Red channel in `[0, 1]`. */
  r: number;
  /** Green channel in `[0, 1]`. */
  g: number;
  /** Blue channel in `[0, 1]`. */
  b: number;
  /** Alpha channel in `[0, 1]` — `0` is fully transparent, `1` is fully opaque. */
  a: number;
}

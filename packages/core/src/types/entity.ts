/**
 * Entity & component primitive types.
 *
 * These are the foundational types with ZERO dependencies.
 * All other modules depend on these.
 */

// ── Entity ────────────────────────────────────────────────────────────────────

/**
 * Opaque entity identifier — 64-bit BigInt with nominal branding.
 *
 * Combines:
 * - 32-bit generation counter (Rust u32) — supports unlimited entity recyclings
 * - 32-bit index (Rust usize) — max 4.3 billion entities
 *
 * Packing: (generation << 32n) | index
 *
 * Branded type prevents accidental mixing with plain bigint values.
 */
export type EntityId = bigint & { readonly __brand: unique symbol };

/**
 * Pack a WASM entity handle into an EntityId.
 * @param index - Entity slot index (0 to 2^32 - 1)
 * @param generation - Generation counter (0 to 2^32 - 1)
 * @returns A branded bigint EntityId
 */
export function createEntityId(index: number, generation: number): EntityId {
  return ((BigInt(generation) << 32n) | BigInt(index)) as EntityId;
}

/**
 * Unpack an EntityId back to its raw components.
 * @param id - The EntityId to unpack
 * @returns Object with index and generation
 */
export function unpackEntityId(id: EntityId): { index: number; generation: number } {
  return {
    index: Number(id & 0xffffffffn),
    generation: Number(id >> 32n),
  };
}

// ── Component ─────────────────────────────────────────────────────────────────

/** String name identifying a component type (e.g. `'Transform'`, `'Velocity'`). */
export type ComponentType = string;

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

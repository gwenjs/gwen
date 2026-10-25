import { GwenError } from "./errors.js";

/**
 * Entity & component primitive types.
 *
 * Foundational entity types. `entityIndex` throws {@link GwenError}
 * `CORE:INVALID_ENTITY_ID` when the id is not a bigint.
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

/**
 * Highest EntityId that Number can convert without rounding.
 * That is generation 2^21 - 1 with any index.
 */
const MAX_EXACT_ENTITY_ID = (1n << 53n) - 1n;

const EntityIdErrorCodes = {
  INVALID_ENTITY_ID: "CORE:INVALID_ENTITY_ID",
} as const;

/**
 * Extract the entity index (lower 32 bits) from an EntityId.
 *
 * Ids up to 2^53 - 1 are exact as Number, so a uint32 cast reads the index
 * and allocates nothing. A BigInt mask is required above that, and it allocates.
 */
export function entityIndex(id: EntityId): number {
  // A number used to throw when mixed with the BigInt mask. Keep that rejection.
  if (typeof id !== "bigint")
    throw new GwenError(EntityIdErrorCodes.INVALID_ENTITY_ID, "EntityId must be a bigint.", {
      composable: "entityIndex",
    });
  if (id <= MAX_EXACT_ENTITY_ID) return Number(id) >>> 0;
  return Number(id & 0xffffffffn);
}

/**
 * Generation (upper bits) of an EntityId.
 * Ids up to 2^53 - 1 stay on the Number path and allocate nothing.
 */
export function entityGeneration(id: EntityId): number {
  if (typeof id !== "bigint")
    throw new GwenError(EntityIdErrorCodes.INVALID_ENTITY_ID, "EntityId must be a bigint.", {
      composable: "entityGeneration",
    });
  if (id <= MAX_EXACT_ENTITY_ID) return Math.floor(Number(id) / 4294967296);
  return Number(id >> 32n);
}

/** String name identifying a component type (e.g. `'Transform'`, `'Velocity'`). */
export type ComponentType = string;

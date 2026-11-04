import type { EntityId } from "@gwenjs/schema";

/**
 * Reads the entity id stored in a `u64` component field as an {@link EntityId}.
 *
 * A component stores an entity id as a plain `bigint`. `EntityId` is that same value with a
 * type brand, so there is nothing to convert at runtime. This function is the one place that
 * adds the brand, so a stored id is read without a conversion. It is not exported from the
 * package entry.
 *
 * @param raw - Value of a `Types.u64` field that holds an entity id.
 * @returns The same value, branded.
 * @internal
 */
export function storedEntityId(raw: bigint): EntityId {
  return raw as EntityId; // boundary: a u64 component field holds a packed EntityId
}

/**
 * Reads `array[index]` where the caller already proved the index is in range.
 *
 * `noUncheckedIndexedAccess` types every indexed read as `T | undefined`. This plain function
 * inlines to the read itself: no branch, no allocation. It is not exported from the package
 * entry.
 *
 * @param array - Array or typed array being read.
 * @param index - Index in `[0, array.length)`.
 * @returns The element at `index`, typed without `undefined`.
 * @internal
 */
export function uncheckedAt<T>(array: ArrayLike<T>, index: number): T {
  return array[index] as T; // boundary: index proven in range by the caller
}

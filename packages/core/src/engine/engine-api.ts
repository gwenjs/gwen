/**
 * GWEN Engine API — Entity ID utilities and field value types.
 * @internal
 */

import { createEntityId, unpackEntityId, type EntityId } from '../types/entity';

// ── EntityId Re-exports ────────────────────────────────────────────────────────
export { createEntityId, unpackEntityId, type EntityId } from '../types/entity';

/**
 * Check structural equality of two EntityIds.
 */
export function entityIdEqual(a: EntityId, b: EntityId): boolean {
  return a === b;
}

/**
 * Serialize an EntityId to a stable string representation.
 * Format: `"${index}:${generation}"` (e.g., `"5:100"`)
 */
export function entityIdToString(id: EntityId): string {
  const { index, generation } = unpackEntityId(id);
  return `${index}:${generation}`;
}

/**
 * Deserialize an EntityId from a string representation.
 * Inverse of `entityIdToString()`.
 */
export function entityIdFromString(str: string): EntityId {
  const [indexStr, generationStr] = str.split(':');
  if (indexStr === undefined || generationStr === undefined) {
    throw new Error(`Invalid EntityId string format: "${str}". Expected "index:generation".`);
  }
  const index = Number.parseInt(indexStr, 10);
  const generation = Number.parseInt(generationStr, 10);

  if (Number.isNaN(index) || Number.isNaN(generation)) {
    throw new Error(
      `Invalid EntityId string format: "${str}". Expected "index:generation" ` +
        `where both are valid integers.`,
    );
  }

  return createEntityId(index, generation);
}

/** Possible JavaScript value for a serialized component field. */
export type ComponentFieldValue = number | bigint | boolean | string;

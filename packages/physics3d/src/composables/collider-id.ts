/**
 * @file collider-id.ts — shared auto-incrementing collider ID counter.
 *
 * A single module-level counter ensures each collider attached to any entity
 * receives a unique ID, regardless of which composable created it.
 */

/** Internal counter. Starts at 0; first issued ID is 1. */
let _colliderId = 0;

/**
 * Returns the next unique auto-incremented collider ID.
 *
 * IDs are monotonically increasing integers starting from 1.
 * Each call advances the counter by 1.
 *
 * @returns A unique collider ID for the current session.
 */
export function nextColliderId(): number {
  return ++_colliderId;
}

/**
 * Reset the collider ID counter back to zero.
 *
 * **For testing only.** Call this in `beforeEach` to ensure deterministic IDs.
 *
 * @internal
 */
export function _resetColliderId(): void {
  _colliderId = 0;
}

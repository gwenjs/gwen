/**
 * @file collider-id.ts — per-engine auto-incrementing collider ID counter.
 *
 * Each engine has its own counter. IDs are unique inside that engine.
 */

import { createEngineLocal, GwenContextError } from "@gwenjs/core";

const counters = createEngineLocal(() => ({ next: 0 }));

/**
 * Returns the next collider ID for the current engine.
 *
 * IDs are monotonically increasing integers starting from 1.
 *
 * @throws {GwenContextError} `CORE:OUTSIDE_ENGINE_CONTEXT` when no engine is current.
 */
export function nextColliderId(): number {
  const box = counters.use();
  box.next += 1;
  return box.next;
}

/**
 * Reset the current engine's collider ID counter back to zero.
 *
 * Outside an engine this is a no-op.
 *
 * @internal
 */
export function _resetColliderId(): void {
  try {
    counters.use().next = 0;
  } catch (error) {
    if (error instanceof GwenContextError) return;
    throw error;
  }
}

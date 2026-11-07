/**
 * Collision event types.
 */

import type { CollisionContact, InternalCollisionEvent, SensorState } from "@gwenjs/physics-core";

export type { CollisionContact, InternalCollisionEvent, SensorState };

export interface CollisionEvent {
  /** Numeric collider id on A side (stable within a prefab declaration). */
  aColliderId?: number;
  /** Numeric collider id on B side (stable within a prefab declaration). */
  bColliderId?: number;
  /** `true` = contact started this frame, `false` = contact ended. */
  started: boolean;
}

/** Plugin batch. `events` carry the slot indices omitted from {@link CollisionEvent}. */
export interface InternalCollisionEventsBatch extends Omit<CollisionEventsBatch, "events"> {
  events: readonly InternalCollisionEvent[];
}

export interface CollisionEventsBatch {
  /** Monotonic physics frame index produced by the WASM world. */
  frame: number;
  /** Number of readable events in `events`. */
  count: number;
  /** Total dropped events since the previous successful read. */
  droppedSinceLastRead: number;
  /** Dropped critical events since the previous successful read. */
  droppedCritical: number;
  /** Dropped non-critical events since the previous successful read. */
  droppedNonCritical: number;
  /** Whether same-frame contact coalescing was enabled when this batch was produced. */
  coalesced: boolean;
  /**
   * Reused event view for the current frame.
   * Treat as read-only and ephemeral.
   */
  events: ReadonlyArray<CollisionEvent>;
}

/**
 * Collision event types.
 */

import type { EntityId } from '@gwenjs/core';

export interface CollisionEvent {
  /** Numeric collider id on A side (stable within a prefab declaration). */
  aColliderId?: number;
  /** Numeric collider id on B side (stable within a prefab declaration). */
  bColliderId?: number;
  /** `true` = contact started this frame, `false` = contact ended. */
  started: boolean;
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

export interface CollisionContact {
  /** Resolved packed EntityId of the first participant. */
  entityA: EntityId;
  /** Resolved packed EntityId of the second participant. */
  entityB: EntityId;
  /** Collider id on A side when available (multi-colliders path). */
  aColliderId?: number;
  /** Collider id on B side when available (multi-colliders path). */
  bColliderId?: number;
  /** `true` = contact started this frame, `false` = contact ended. */
  started: boolean;
}

export interface SensorState {
  /** Number of distinct overlapping contacts right now. */
  contactCount: number;
  /** `true` when at least one contact is active. */
  isActive: boolean;
}

import type { EntityId } from '@gwenjs/core';
import type { Physics3DBodyOptions } from './bodies';

// ─── Sensor ─────────────────────────────────────────────────────────────────────

/**
 * Persistent sensor contact state for a `(entityId, sensorId)` pair.
 * Updated each frame from collision events; readable in O(1).
 */
export interface Physics3DSensorState {
  /** Number of overlapping contacts right now. */
  contactCount: number;
  /** `true` when at least one contact is active. */
  isActive: boolean;
}

// ─── Collision events ──────────────────────────────────────────────────────────

/**
 * A resolved collision contact emitted by the Physics3D plugin.
 *
 * `entityA` and `entityB` are packed `EntityId`s ready to pass to the ECS.
 */
export interface Physics3DCollisionContact {
  /** Packed EntityId of the first participant. */
  entityA: EntityId;
  /** Packed EntityId of the second participant. */
  entityB: EntityId;
  /** Collider id on A side (when multi-collider path is used). */
  aColliderId?: number;
  /** Collider id on B side (when multi-collider path is used). */
  bColliderId?: number;
  /** `true` = contact started this frame, `false` = contact ended. */
  started: boolean;
}

// ─── Prefab extension ──────────────────────────────────────────────────────────

/**
 * Extension schema for `definePrefab({ extensions: { physics3d: … } })`.
 *
 * When a prefab is instantiated, the Physics3D plugin reads this object and
 * automatically creates the rigid body and attaches all declared colliders.
 */
export interface Physics3DPrefabExtension {
  /** Body options for the prefab instance. */
  body?: Physics3DBodyOptions;
  /**
   * Optional per-entity collision callback.
   * Called during `onUpdate` for every contact event involving this entity.
   */
  onCollision?: (entityA: EntityId, entityB: EntityId, contact: Physics3DCollisionContact) => void;
}

// ─── Plugin hooks ──────────────────────────────────────────────────────────────

/**
 * Hooks emitted by the Physics3D plugin.
 *
 * Register via `api.hooks.hook('physics3d:collision', ...)`.
 */
export interface Physics3DPluginHooks {
  /**
   * Fired once per frame during `onUpdate` with all resolved collision contacts.
   * The array is read-only and ephemeral — do not retain across frames.
   */
  'physics3d:collision': (contacts: ReadonlyArray<Physics3DCollisionContact>) => void;

  /**
   * Emitted on every sensor state transition (inactive → active or active → inactive).
   * Not emitted on "stay" frames.
   *
   * @param entityId - Packed EntityId of the entity whose sensor changed.
   * @param sensorId - Stable sensor id (e.g. `SENSOR_ID_FOOT`).
   * @param state    - Updated sensor state after the transition.
   */
  'physics3d:sensor:changed': (
    entityId: EntityId,
    sensorId: number,
    state: Physics3DSensorState,
  ) => void;
}

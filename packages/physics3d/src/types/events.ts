import type { CollisionContact, SensorState } from "@gwenjs/physics-core";
import type { EntityId } from "@gwenjs/schema";
import type { Physics3DBodyOptions } from "./bodies";

export type { CollisionContact, SensorState };

// ─── Prefab extension ──────────────────────────────────────────────────────────

/**
 * Extension schema for `definePrefab(components, { extensions: { physics3d: … } })`.
 *
 * When a prefab is instantiated, the Physics3D plugin reads this object and
 * automatically creates the rigid body and attaches all declared colliders.
 */
export interface Physics3DPrefabExtension {
  /** Body options for the prefab instance. */
  body?: Physics3DBodyOptions;
  /**
   * Optional per-entity collision callback.
   * Called during `engine:update` for every contact event involving this entity.
   */
  onCollision?: (entityA: EntityId, entityB: EntityId, contact: CollisionContact) => void;
}

// ─── Plugin hooks ──────────────────────────────────────────────────────────────

/**
 * `physics3d:body-disabled` payload.
 * The plugin emits this after a step that disabled a body, including one Rapier quarantined.
 */
export interface Physics3DBodyDisabled {
  readonly entity: EntityId;
  readonly reason: "non-finite" | "out-of-bounds" | "velocity";
}

/**
 * Hooks emitted by the Physics3D plugin.
 *
 * `physics:collision` and `physics:sensor:changed` come from `@gwenjs/physics-core`.
 * Register the package hook via `engine.hooks.hook('physics3d:body-disabled', ...)`.
 */
export interface Physics3DPluginHooks {
  /**
   * Fired when a step disables a body: a dynamic body that left the accepted world, or a body Rapier quarantined.
   * `reason` is `non-finite`, `out-of-bounds` or `velocity`.
   */
  "physics3d:body-disabled": (payload: Physics3DBodyDisabled) => void;
}

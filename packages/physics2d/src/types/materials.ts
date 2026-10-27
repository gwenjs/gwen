/**
 * Plugin hooks, material presets, and collider shapes.
 */

import { defineHooks } from "@gwenjs/core";
import type { InferHooks, EntityId } from "@gwenjs/schema";
import type { CollisionContact, SensorState, CollisionEventsBatch } from "./events";

/**
 * `physics2d:body-disabled` payload.
 * The plugin emits this after a step that disabled a body, including one Rapier quarantined.
 */
export interface Physics2DBodyDisabled {
  readonly entity: EntityId;
  readonly reason: "non-finite" | "out-of-bounds" | "velocity";
}

const physics2dBodyDisabledHooks = defineHooks({
  "physics2d:body-disabled": (_payload: Physics2DBodyDisabled): void => undefined,
});

export interface Physics2DPluginHooks extends InferHooks<typeof physics2dBodyDisabledHooks> {
  "physics:collision": (contacts: ReadonlyArray<CollisionContact>) => void;
  "physics:collision:batch": (batch: Readonly<CollisionEventsBatch>) => void;
  "physics:sensor:changed": (entityId: EntityId, sensorId: number, state: SensorState) => void;
}

export interface PhysicsMaterialPreset {
  friction?: number;
  restitution?: number;
  density?: number;
}

export type PhysicsMaterialPresetName = "default" | "ice" | "rubber";

export const PHYSICS_MATERIAL_PRESETS: Record<
  PhysicsMaterialPresetName,
  Required<PhysicsMaterialPreset>
> = {
  default: { friction: 0.5, restitution: 0, density: 1.0 },
  ice: { friction: 0.02, restitution: 0, density: 1.0 },
  rubber: { friction: 1.2, restitution: 0.85, density: 1.0 },
};

export type PhysicsColliderShape = "box" | "ball";

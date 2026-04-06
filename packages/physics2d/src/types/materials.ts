/**
 * Plugin hooks, material presets, and collider shapes.
 */

import type { EntityId } from '@gwenjs/core';
import type { CollisionContact, SensorState, CollisionEventsBatch } from './events';

export interface Physics2DPluginHooks {
  'physics:collision': (contacts: ReadonlyArray<CollisionContact>) => void;
  'physics:collision:batch': (batch: Readonly<CollisionEventsBatch>) => void;
  'physics:sensor:changed': (entityId: EntityId, sensorId: number, state: SensorState) => void;
}

export interface PhysicsMaterialPreset {
  friction?: number;
  restitution?: number;
  density?: number;
}

export type PhysicsMaterialPresetName = 'default' | 'ice' | 'rubber';

export const PHYSICS_MATERIAL_PRESETS: Record<
  PhysicsMaterialPresetName,
  Required<PhysicsMaterialPreset>
> = {
  default: { friction: 0.5, restitution: 0, density: 1.0 },
  ice: { friction: 0.02, restitution: 0, density: 1.0 },
  rubber: { friction: 1.2, restitution: 0.85, density: 1.0 },
};

export type PhysicsColliderShape = 'box' | 'ball';

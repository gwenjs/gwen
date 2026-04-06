import type {
  PhysicsColliderDef,
  Physics2DPrefabExtension,
  ColliderOptions,
  Physics2DAPI,
} from '../types';
import { PHYSICS_MATERIAL_PRESETS } from '../types';
import { LayerRegistry, PIXELS_PER_METER } from '../config';

/**
 * Resolves a material definition from presets or overrides.
 */
export function resolveMaterial(
  material: PhysicsColliderDef['material'] | Physics2DPrefabExtension['material'] | undefined,
  overrides: Pick<PhysicsColliderDef, 'friction' | 'restitution' | 'density'>,
  fallback: { friction: number; restitution: number; density: number },
) {
  const base = typeof material === 'string' ? PHYSICS_MATERIAL_PRESETS[material] : (material ?? {});

  return {
    friction: overrides.friction ?? base.friction ?? fallback.friction,
    restitution: overrides.restitution ?? base.restitution ?? fallback.restitution,
    density: overrides.density ?? base.density ?? fallback.density,
  };
}

/**
 * Adds a collider to a rigid body based on a prefab definition.
 */
export function addPrefabCollider(
  service: Physics2DAPI,
  bodyHandle: number,
  collider: PhysicsColliderDef,
  registry: LayerRegistry,
  colliderId?: number,
  defaultFriction = 0,
): void {
  const material = resolveMaterial(collider.material, collider, {
    friction: defaultFriction,
    restitution: 0,
    density: 1.0,
  });
  const colliderOpts: ColliderOptions = {
    restitution: material.restitution,
    friction: material.friction,
    isSensor: collider.isSensor ?? false,
    density: material.density,
    membershipLayers: registry.resolve(collider.membershipLayers, 'membership'),
    filterLayers: registry.resolve(collider.filterLayers, 'filter'),
    ...(colliderId !== undefined ? { colliderId } : {}),
  };

  if (collider.offsetX !== undefined) {
    colliderOpts.offsetX = collider.offsetX / PIXELS_PER_METER;
  }
  if (collider.offsetY !== undefined) {
    colliderOpts.offsetY = collider.offsetY / PIXELS_PER_METER;
  }

  if (collider.shape === 'ball') {
    if (collider.radius === undefined) {
      throw new Error(
        `[Physics2D] Invalid collider config: shape="ball" requires \`radius\` (collider id: ${collider.id ?? '<unnamed>'}).`,
      );
    }
    service.addBallCollider(bodyHandle, collider.radius / PIXELS_PER_METER, colliderOpts);
    return;
  }

  if (collider.shape === 'box') {
    if (collider.hw === undefined || collider.hh === undefined) {
      throw new Error(
        `[Physics2D] Invalid collider config: shape="box" requires both \`hw\` and \`hh\` (collider id: ${collider.id ?? '<unnamed>'}).`,
      );
    }
    service.addBoxCollider(
      bodyHandle,
      collider.hw / PIXELS_PER_METER,
      collider.hh / PIXELS_PER_METER,
      colliderOpts,
    );
    return;
  }

  throw new Error(
    `[Physics2D] Invalid collider shape \`${String(collider.shape)}\` (collider id: ${collider.id ?? '<unnamed>'}).`,
  );
}

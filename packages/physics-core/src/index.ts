/**
 * Shared physics types, layers and collision events.
 * Dimension packages adapt these types. They do not declare them again.
 */

export type { CollisionContact, SensorState } from "./augment.js";

export type {
  BodyKind,
  BodyOptions,
  BoxColliderOptions,
  CapsuleColliderOptions,
  ColliderFilterOptions,
  Dim,
  DimRot,
  DimVec,
  KinematicBodyOptions,
  LayerSelector,
  PhysicsConfigBase,
  QualityPreset,
  SphereColliderOptions,
} from "./types.js";
export { BODY_KIND_CODE, QUALITY_PRESET_CODE } from "./types.js";

export {
  LAYER_ALL,
  LAYER_ERROR_CODES,
  LayerRegistry,
  MAX_LAYERS,
  defineLayers,
} from "./layer-registry.js";

export { readCollisionEvents } from "./events.js";
export type { CollisionEventLayout, InternalCollisionEvent } from "./events.js";

export {
  SENSOR_ID_FOOT,
  clearEngineContacts,
  createContactRegistry,
  createSensorRegistry,
  onContact,
  onSensorEnter,
  onSensorExit,
} from "./registries.js";
export type { ContactRegistry, SensorRegistry } from "./registries.js";

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

export { resolveMaterial, SHARED_MATERIAL_PRESETS } from "./materials.js";
export type { MaterialTable, MaterialValues, SharedMaterialPreset } from "./materials.js";

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

export { createPhysicsPlugin } from "./plugin.js";
export type { PhysicsAdapter } from "./adapter.js";
export type { PhysicsSensorTracker } from "./sensor-tracker.js";

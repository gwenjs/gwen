/**
 * @gwenjs/physics2d
 *
 * 2D physics plugin for GWEN — pure adapter providing 2D rigid-body physics via the core WASM.
 * Public barrel exports. Implementation lives in ./plugin/ and ./composables/
 */

// ─── Plugin exports ─────────────────────────────────────────────────────────
export { Physics2DPlugin, Physics2D, physics2D } from './plugin/index';
export { ShapeComponent } from './shape-component';
export type { ShapeData } from './shape-component';
export { ContactRingBuffer, CONTACT_EVENT_BYTES, RING_CAPACITY } from './ring-buffer';

// ─── Module, composables & type augmentations ───────────────────────────────
export * from './augment';
export { usePhysics2D, useRigidBody, useCollider } from './composables';
export {
  useStaticBody,
  useDynamicBody,
  useBoxCollider,
  useSphereCollider,
  useCapsuleCollider,
  defineLayers,
  onContact,
  onSensorEnter,
  onSensorExit,
  _clearContactCallbacks,
  _clearSensorCallbacks,
  useShape,
  useKinematicBody,
} from './composables/index';
export { physics2dVitePlugin } from './vite-plugin';
export type {
  BoxColliderOptions,
  SphereColliderOptions,
  CapsuleColliderOptions,
  ShapeOptions,
} from './composables/index';
export type {
  StaticBodyOptions,
  StaticBodyHandle,
  DynamicBodyOptions,
  DynamicBodyHandle,
  KinematicBodyOptions,
  KinematicBodyHandle,
  BoxColliderHandle,
  CircleColliderHandle,
  CapsuleColliderHandle,
  ContactEvent,
  Physics2DLayerDefinition,
} from './types';

// ─── Re-export systems & helper utilities ───────────────────────────────────
export {
  createPhysicsKinematicSyncSystem,
  createPlatformerGroundedSystem,
  SENSOR_ID_FOOT,
} from './systems';
export { buildTilemapPhysicsChunks, patchTilemapPhysicsChunk } from './helpers/tilemap';
export type { PhysicsKinematicSyncSystemOptions, PlatformerGroundedSystemOptions } from './systems';

// ─── Re-export public types ───────────────────────────────────────────────
export type {
  Physics2DConfig,
  Physics2DAPI,
  CollisionEvent,
  CollisionEventsBatch,
  CollisionContact,
  ColliderOptions,
  RigidBodyType,
  Physics2DPrefabExtension,
  Physics2DPluginHooks,
  PhysicsColliderDef,
  PhysicsQualityPreset,
  PhysicsColliderShape,
  SensorState,
  TilemapPhysicsChunkMap,
} from './types';

export {
  PHYSICS2D_BRIDGE_SCHEMA_VERSION,
  PHYSICS_QUALITY_PRESET_CODE,
  PHYSICS2D_WASM_EVENT_STRIDE,
} from './types';

export { default } from './module';

/**
 * @gwenjs/physics2d
 *
 * 2D physics plugin for GWEN — pure adapter providing 2D rigid-body physics via the core WASM.
 * Public barrel exports. Implementation lives in ./plugin/ and ./composables/
 */

// ─── Plugin exports ─────────────────────────────────────────────────────────
export { Physics2DPlugin } from "./plugin/index";

// ─── Module, composables & type augmentations ───────────────────────────────
export * from "./augment";
export { usePhysics2D, useRigidBody, useCollider } from "./composables";
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
  useShape,
  useKinematicBody,
} from "./composables/index";
export { physics2dVitePlugin } from "./vite-plugin";
export type {
  BoxColliderOptions,
  SphereColliderOptions,
  CapsuleColliderOptions,
  ShapeOptions,
} from "./composables/index";
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
} from "./types";

// ─── Re-export systems & helper utilities ───────────────────────────────────
export {
  createPhysicsKinematicSyncSystem,
  createPlatformerGroundedSystem,
  SENSOR_ID_FOOT,
} from "./systems";
export { buildTilemapPhysicsChunks, patchTilemapPhysicsChunk } from "./helpers/tilemap";
export type { PhysicsKinematicSyncSystemOptions, PlatformerGroundedSystemOptions } from "./systems";

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
} from "./types";

export { default } from "./module";

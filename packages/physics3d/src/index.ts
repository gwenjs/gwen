/**
 * @gwenjs/physics3d
 *
 * 3D physics plugin for GWEN — Rapier3D adapter with full collider, sensor,
 * collision event, and layer support. Falls back to a deterministic local
 * TypeScript simulation when the WASM physics3d variant is unavailable.
 */

import "./augment";

export { Physics3DPlugin } from "./plugin/index";
export { Physics3DPlugin as default } from "./plugin/index";
export type { PreloadedBvhHandle } from "./plugin/bvh";
export { preloadMeshCollider } from "./plugin/bvh";
export { Physics3DErrorCodes } from "./errors/codes";
export type { Physics3DErrorCode } from "./errors/codes";

export type {
  Physics3DAPI,
  Physics3DBodyOptions,
  Physics3DBodyHandle,
  Physics3DBodyKind,
  Physics3DBodyState,
  Physics3DBodySnapshot,
  Physics3DColliderOptions,
  Physics3DCollisionContact,
  Physics3DSensorState,
  Physics3DQualityPreset,
  Physics3DPrefabExtension,
  Physics3DPluginHooks,
  Physics3DVec3,
  Physics3DQuat,
  Physics3DConfig,
  Physics3DEntityId,
} from "./types";

export * from "./helpers/contact";
export * from "./helpers/movement";
export * from "./helpers/queries";
export * from "./systems";

// ─── Module, composables & type augmentations ─────────────────────────────────
export * from "./augment";
export { usePhysics3D } from "./composables";
export { default as physics3dModule } from "./module";

// ─── RFC-06 DX composables ────────────────────────────────────────────────────
export {
  useStaticBody,
  useDynamicBody,
  useKinematicBody,
  useBoxCollider,
  useSphereCollider,
  useCapsuleCollider,
  useMeshCollider,
  useConvexCollider,
  useCompoundCollider,
  useHeightfieldCollider,
  defineLayers,
  onContact,
  onSensorEnter,
  onSensorExit,
  useBulkStaticBoxes,
  useRaycast,
  useShapeCast,
  useOverlap,
  useJoint,
} from "./composables/index";
export type {
  BoxColliderOptions3D,
  SphereColliderOptions3D,
  CapsuleColliderOptions3D,
  ConvexColliderOptions,
  HeightfieldColliderOptions,
  UseRaycastHandle,
  UseShapeCastHandle,
  UseOverlapHandle,
  UseJointHandle,
  UseJointOpts,
} from "./composables/index";
export { physics3dVitePlugin } from "./vite-plugin";
export type {
  ContactEvent3D,
  StaticBodyOptions3D,
  DynamicBodyOptions3D,
  KinematicBodyOptions3D,
  StaticBodyHandle3D,
  DynamicBodyHandle3D,
  KinematicBodyHandle3D,
  ColliderHandle3D,
  BoxColliderHandle3D,
  SphereColliderHandle3D,
  CapsuleColliderHandle3D,
  MeshColliderHandle3D,
  MeshColliderOptions,
  ConvexColliderHandle3D,
  HeightfieldColliderHandle3D,
  CompoundColliderHandle3D,
  CompoundShapeSpec,
  CompoundColliderOptions3D,
} from "./types";

export type { BulkStaticBoxesOptions, BulkStaticBoxesResult } from "./types";

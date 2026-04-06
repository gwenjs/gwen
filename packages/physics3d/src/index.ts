/// <reference types="vite/client" />

/**
 * @gwenjs/physics3d
 *
 * 3D physics plugin for GWEN — Rapier3D adapter with full collider, sensor,
 * collision event, and layer support. Falls back to a deterministic local
 * TypeScript simulation when the WASM physics3d variant is unavailable.
 */

import './augment';

export { Physics3DPlugin } from './plugin/index';
export { Physics3DPlugin as default } from './plugin/index';
export type { PreloadedBvhHandle } from './plugin/bvh';
export { _clearBvhCache, preloadMeshCollider } from './plugin/bvh';
export { EVENT_STRIDE_3D, MAX_EVENTS_3D, COLLIDER_ID_ABSENT } from './plugin/constants';
export { ContactRingBuffer3D, CONTACT_EVENT_FLOATS, RING_CAPACITY_3D } from './plugin/ring-buffer';
export { Physics3DErrorCodes } from './errors/codes';
export type { Physics3DErrorCode } from './errors/codes';

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
} from './types';

export { normalizePhysics3DConfig } from './config';
export { QUALITY_PRESETS } from './config';

export * from './helpers/contact';
export * from './helpers/movement';
export * from './helpers/queries';
export * from './systems';

// ─── Module, composables & type augmentations ─────────────────────────────────
export * from './augment';
export { usePhysics3D } from './composables';
export { default as physics3dModule } from './module';

// ─── RFC-06 DX composables ────────────────────────────────────────────────────
export * from './composables/index';
export { physics3dVitePlugin, createGwenPhysics3DPlugin } from './vite-plugin';
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
} from './types';

export type { BulkStaticBoxesOptions, BulkStaticBoxesResult } from './types';

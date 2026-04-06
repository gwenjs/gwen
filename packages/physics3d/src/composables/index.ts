/**
 * @file Barrel export for all RFC-06 DX composables.
 *
 * Import individual composables from this file rather than from their
 * individual modules to benefit from tree-shaking and stable import paths.
 *
 * @example
 * ```typescript
 * import { useStaticBody, useBoxCollider, onContact } from '@gwenjs/physics3d'
 * ```
 */

export { useStaticBody } from './use-static-body';
// re-export StaticBodyOptions3D via types.ts

export { useDynamicBody } from './use-dynamic-body';
// re-export DynamicBodyOptions3D via types.ts

export { useKinematicBody } from './use-kinematic-body';
// re-export KinematicBodyOptions3D via types.ts

export { useBoxCollider } from './use-box-collider';
export type { BoxColliderOptions3D } from './use-box-collider';

export { useSphereCollider } from './use-sphere-collider';
export type { SphereColliderOptions3D } from './use-sphere-collider';

export { useCapsuleCollider } from './use-capsule-collider';
export type { CapsuleColliderOptions3D } from './use-capsule-collider';

export { useMeshCollider } from './use-mesh-collider';
export type { MeshColliderOptions } from '../types';

export { useConvexCollider } from './use-convex-collider';
export type { ConvexColliderOptions } from './use-convex-collider';

export { useCompoundCollider } from './use-compound-collider';
export type { CompoundColliderOptions3D } from './use-compound-collider';

export { useHeightfieldCollider } from './use-heightfield-collider';
export type { HeightfieldColliderOptions } from './use-heightfield-collider';

export { defineLayers } from './define-layers';

export { onContact, _dispatchContactEvent, _clearContactCallbacks } from './on-contact';

export {
  onSensorEnter,
  onSensorExit,
  _dispatchSensorEnter,
  _dispatchSensorExit,
  _clearSensorCallbacks,
} from './on-sensor';

export { useBulkStaticBoxes } from './use-bulk-static-boxes';

export { useRaycast } from './use-raycast';
export type { UseRaycastHandle } from './use-raycast';

export { useShapeCast } from './use-shape-cast';
export type { UseShapeCastHandle } from './use-shape-cast';

export { useOverlap } from './use-overlap';
export type { UseOverlapHandle } from './use-overlap';

export { useJoint } from './use-joint';
export type { UseJointHandle, UseJointOpts } from './use-joint';

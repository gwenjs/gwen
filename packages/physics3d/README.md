# @gwenjs/physics3d

Physics3D plugin foundation for GWEN.

Current scope:

- validates `physics3d` core variant,
- initializes 3D physics world via `physics3d_init`,
- auto-steps simulation on the `engine:before-update` hook when enabled,
- registers typed `physics3d` service,
- exposes an EntityId-native body registry foundation (`createBody/removeBody/hasBody/getBodyCount`).

## Installation

```bash
npm install @gwenjs/physics3d
```

## Usage

```ts
import { setupGwen } from "@gwenjs/core";
import { Physics3DPlugin } from "@gwenjs/physics3d";

const engine = await setupGwen({ variant: "physics3d" });
await engine.use(Physics3DPlugin({ gravity: { y: -9.81 } }));

await engine.start();

const physics3d = engine.getAPI().services.get("physics3d");
const body = physics3d.createBody(1n, {
  kind: "dynamic",
  initialPosition: { x: 0, y: 1, z: 0 },
});
physics3d.setBodyKind(1n, "kinematic");
console.log("kind", physics3d.getBodyKind(1n));
physics3d.setBodyState(1n, {
  linearVelocity: { x: 3, y: 0, z: 0 },
});
physics3d.setLinearVelocity(1n, { x: 5 });
console.log("vx", physics3d.getLinearVelocity(1n)?.x);
physics3d.setAngularVelocity(1n, { y: 1.2 });
console.log("wy", physics3d.getAngularVelocity(1n)?.y);
physics3d.applyImpulse(1n, { y: 2 });
const state = physics3d.getBodyState(1n);
console.log(body.bodyId, physics3d.getBodyCount(), state?.position.y);
```

## Notes

- This package is intentionally minimal for RFC-005 foundation.
- Body registry APIs are EntityId-first and align with RFC-009 migration goals.
- `physics3d.step(delta)` remains available for advanced/manual control paths.
- Local deterministic stepping rules:
  - `dynamic`: gravity + velocity integration,
  - `kinematic`: velocity integration without gravity,
  - `fixed`: no position integration.
- `mass`, `linearDamping`, and `angularDamping` options are applied in local simulation.
- Higher-level rigid-body and collider APIs are added incrementally.

## Public exports

### `.`

Values: `Physics3DErrorCodes`, `Physics3DPlugin`, `SENSOR_ID_FOOT`, `SENSOR_ID_HEAD`, `applyDirectionalImpulse`, `createPhysicsKinematicSyncSystem`, `dedupeContactsByPair`, `default`, `defineLayers`, `getBodySnapshot`, `getSpeed`, `isSensorActive`, `moveKinematicByVelocity`, `onContact`, `onSensorEnter`, `onSensorExit`, `physics3dModule`, `physics3dVitePlugin`, `preloadMeshCollider`, `selectContactsForEntityId`, `selectResolvedContactsForEntityId`, `useBoxCollider`, `useBulkStaticBoxes`, `useCapsuleCollider`, `useCompoundCollider`, `useConvexCollider`, `useDynamicBody`, `useHeightfieldCollider`, `useJoint`, `useKinematicBody`, `useMeshCollider`, `useOverlap`, `usePhysics3D`, `useRaycast`, `useShapeCast`, `useSphereCollider`, `useStaticBody`

Types: `BoxColliderHandle3D`, `BoxColliderOptions3D`, `BulkStaticBoxesOptions`, `BulkStaticBoxesResult`, `CapsuleColliderHandle3D`, `CapsuleColliderOptions3D`, `ColliderHandle3D`, `CompoundColliderHandle3D`, `CompoundColliderOptions3D`, `CompoundShapeSpec`, `ContactEvent3D`, `ConvexColliderHandle3D`, `ConvexColliderOptions`, `DynamicBodyHandle3D`, `DynamicBodyOptions3D`, `HeightfieldColliderHandle3D`, `HeightfieldColliderOptions`, `KinematicBodyHandle3D`, `KinematicBodyOptions3D`, `MeshColliderHandle3D`, `MeshColliderOptions`, `Physics3DAPI`, `Physics3DBodyHandle`, `Physics3DBodyKind`, `Physics3DBodyOptions`, `Physics3DBodySnapshot`, `Physics3DBodyState`, `Physics3DColliderOptions`, `Physics3DCollisionContact`, `Physics3DConfig`, `Physics3DEntityId`, `Physics3DErrorCode`, `Physics3DPluginHooks`, `Physics3DPrefabExtension`, `Physics3DQualityPreset`, `Physics3DQuat`, `Physics3DSensorState`, `Physics3DVec3`, `PhysicsKinematicSyncSystemOptions`, `PreloadedBvhHandle`, `SphereColliderHandle3D`, `SphereColliderOptions3D`, `StaticBodyHandle3D`, `StaticBodyOptions3D`, `UseJointHandle`, `UseJointOpts`, `UseOverlapHandle`, `UseRaycastHandle`, `UseShapeCastHandle`

### `./module`

Values: `default`

Types: none

### `./internal`

no semver guarantee — framework packages and generated code only

Values: `COLLIDER_ID_ABSENT`, `EVENT_STRIDE_3D`, `MAX_EVENTS_3D`, `QUALITY_PRESETS`, `normalizePhysics3DConfig`

Types: none

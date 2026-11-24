---
title: "@gwenjs/physics3d"
description: "API reference for @gwenjs/physics3d."
---

# @gwenjs/physics3d

`pnpm add @gwenjs/physics3d`

3D physics engine module powered by Rapier3D. Provides rigid body dynamics, collision detection, sensor events, layer-based filtering, and BVH-accelerated mesh colliders.

```ts check
import { defineComponent, Types } from "@gwenjs/core";
import { defineActor, definePrefab } from "@gwenjs/core/actor";
import {
  Physics3DPlugin,
  onSensorEnter,
  useBoxCollider,
  useDynamicBody,
} from "@gwenjs/physics3d";
import type { BoxColliderHandle3D, DynamicBodyHandle3D } from "@gwenjs/physics3d";

const plugin = Physics3DPlugin({ gravity: { y: -9.81 } });

const Position = defineComponent({
  name: "DocsPhysics3dPos",
  schema: { x: Types.f32, y: Types.f32, z: Types.f32 },
  defaults: { x: 0, y: 0, z: 0 },
});

const CratePrefab = definePrefab([{ def: Position, defaults: { x: 0, y: 0, z: 0 } }]);

export const CrateActor = defineActor(CratePrefab, () => {
  const body: DynamicBodyHandle3D = useDynamicBody({ mass: 5, fixedRotation: true });
  const zone: BoxColliderHandle3D = useBoxCollider({ w: 1, h: 1, d: 1, isSensor: true });
  onSensorEnter(zone.colliderId, (entityId) => {
    void entityId;
    void body;
  });
});

void plugin;
```

## Module Configuration

Register the module in `gwen.config.ts`:

```ts
// gwen.config.ts
export default defineConfig({
  modules: ['@gwenjs/physics3d'],
  physics3d: {
    gravity: { x: 0, y: -9.81, z: 0 },
    maxEntities: 10_000,
    qualityPreset: 'medium',
    debug: false,
    coalesceEvents: true,
    maxLinearVelocity: 400,
    layers: { default: 0, player: 1, enemy: 2 },
    vite: {
      bvhPrebake: false,
    },
  },
})
```

### Physics3DConfig

| Field | Type | Default | Description |
|---|---|---|---|
| `gravity` | `Partial<Vec3>` | `{ x: 0, y: -9.81, z: 0 }` | World gravity vector. A missing component uses the default component (x 0, y -9.81, z 0) (`packages/physics3d/src/config.ts:21`). |
| `maxEntities` | `number` | `10_000` | Maximum number of physics entities |
| `qualityPreset` | `QualityPreset` | `'medium'` | Solver quality: `'low'`, `'medium'`, `'high'`, or `'esport'` |
| `debug` | `boolean` | `false` | Enable runtime physics debug logs |
| `coalesceEvents` | `boolean` | `true` | Merge duplicate contact events within a frame |
| `maxLinearVelocity` | `number` | `400` | Linear speed cap (m/s). Also Rapier's per-substep cap. A faster dynamic body is scaled and stays enabled |
| `layers` | `Record<string, number>` | `{}` | Layer name to bit index, integers `0..31`, at most 32 |
| `vite` | `object` | — | Build-time Vite plugin options (see below) |
| `vite.bvhPrebake` | `boolean` | `false` | Pre-bake BVH for `useMeshCollider('./x.glb')` at build time |

## Rapier 0.36

Rapier clamps linear speed after each solver substep. The default cap is 400 m/s. `maxLinearVelocity` sets GWEN's cap and that Rapier cap (`crates/gwen-core/src/physics2d/world.rs:752-753`, `crates/gwen-core/src/physics3d/world.rs:809-810`). A new world starts at 400 (`crates/gwen-core/src/physics2d/world.rs:200`, `crates/gwen-core/src/physics3d/world.rs:714`). A value that is not finite, or that is zero or negative, is refused and both caps stay.

A body falls asleep after half a second below the sleep threshold (`rapier3d-0.36.1/src/dynamics/rigid_body_components.rs:1375`, `crates/gwen-core/tests/physics3d_rapier_036.rs:333`). An island sleeps once every body in it is eligible (`crates/gwen-core/tests/physics3d_rapier_036.rs:356`).

With one CCD substep, a fast dynamic box does not pass through a thin fixed wall even when its own CCD flag is off (`crates/gwen-core/tests/physics2d_rapier_036.rs:241`). The Low preset keeps that one substep (`crates/gwen-core/src/physics_common/quality.rs:43-47`). Zero substeps turns this CCD off, and the same box passes the wall (`crates/gwen-core/src/physics2d/world.rs:1711`).

Extra solver iterations add substeps for the whole island that contains the body. In 2D, `additionalSolverIterations` is stored at 16 or below (`packages/physics2d/src/types/api.ts:71`, `crates/gwen-core/src/physics2d/world.rs:19`, `crates/gwen-core/src/physics2d/world.rs:252`). In 3D, `set_body_solver_iterations` uses the same cap of 0–16 (`crates/gwen-core/src/physics3d/world.rs:341`, `crates/gwen-core/src/physics3d/world.rs:2805-2807`). 0 adds no extra substeps. 17 and above are stored as 16. The physics3d plugin invokes `physics3d_set_body_solver_iterations` only when the mapped count is above 0 (`packages/physics3d/src/plugin/body-management.ts:277-280`).

## Composables

All composables are imported from `@gwenjs/physics3d` and must be called inside `defineActor`.

### Bodies

#### useDynamicBody(options?)

```ts
function useDynamicBody(options?: DynamicBodyOptions3D): DynamicBodyHandle3D
```

Adds a dynamic body. Copied fields: `mass?`, `gravityScale?`, `linearDamping?`, `angularDamping?`, `ccdEnabled?`, `initialPosition?`, `initialRotation?`, `initialLinearVelocity?`, `initialAngularVelocity?`, `fixedRotation?`, `quality?`. `layer`, `mask`, `material` and `isSensor` are on the type and are not copied. There is no `restitution` field.

**Returns:** `DynamicBodyHandle3D`

```ts
import { useDynamicBody, useSphereCollider } from '@gwenjs/physics3d'

export const BallActor = defineActor(BallPrefab, () => {
  const body = useDynamicBody({ mass: 5, fixedRotation: true })
  useSphereCollider({ radius: 1 })
  void body
})
```

#### useStaticBody(options?)

```ts
function useStaticBody(options?: StaticBodyOptions3D): StaticBodyHandle3D
```

Adds a fixed body. `StaticBodyOptions3D` lists `isSensor`, `layer`, `mask` and `material`. `useStaticBody` does not read them. The handle has `bodyId`, `active`, `enable()` and `disable()`.

```ts
import { useStaticBody, useMeshCollider } from '@gwenjs/physics3d'

export const TerrainActor = defineActor(TerrainPrefab, () => {
  useStaticBody()
  useMeshCollider('./terrain.glb')
})
```

#### useKinematicBody(options?)

```ts
function useKinematicBody(options?: KinematicBodyOptions3D): KinematicBodyHandle3D
```

Adds a kinematic body. Fields: `initialPosition?`, `initialRotation?`, `fixedRotation?`. Gravity does not move it.

**Returns:** `KinematicBodyHandle3D`

```ts
import { useKinematicBody, useCapsuleCollider } from '@gwenjs/physics3d'

export const PlayerActor = defineActor(PlayerPrefab, () => {
  const body = useKinematicBody({ fixedRotation: true })
  useCapsuleCollider({ radius: 0.4, height: 1.2 })
  void body
})
```

### Colliders

#### useBoxCollider(options)

```ts
function useBoxCollider(options: BoxColliderOptions3D): BoxColliderHandle3D
```

Attaches a box to the body already registered by `useStaticBody` or `useDynamicBody`. `w`, `h` and `d` are full sizes. `d` defaults to `w`. The stored half sizes are those sizes divided by 2. Optional: `offsetX`, `offsetY`, `offsetZ`, `isSensor`, `layer`, `mask`, `material`.

```ts
useBoxCollider({ w: 1, h: 2, d: 1 })
```

#### useSphereCollider(options)

```ts
function useSphereCollider(options: SphereColliderOptions3D): SphereColliderHandle3D
```

Attaches a sphere to the body already registered on this entity. Fields: `radius`, optional `offsetX`, `offsetY`, `offsetZ`, `isSensor`, `layer`, `mask`, `material`.

```ts
useSphereCollider({ radius: 0.5 })
```

#### useCapsuleCollider(options)

```ts
function useCapsuleCollider(options: CapsuleColliderOptions3D): CapsuleColliderHandle3D
```

Attaches a capsule to the body already registered on this entity. `height` is the cylinder length. The stored half-height is `height / 2`. `axis` is accepted and not applied. Other optional fields match the sphere.

```ts
useCapsuleCollider({ radius: 0.4, height: 1.2 })
```

#### useMeshCollider(path | options)

```ts
function useMeshCollider(source: string | {
  vertices: Float32Array
  indices: Uint32Array
  sensor?: boolean
}): void
```

Adds a trimesh (arbitrary polygon mesh) collider. Intended for static geometry only. Accepts either a `.glb` path string (resolved at build time when BVH pre-baking is enabled) or explicit vertex/index data.

```ts
// Path-based (triggers BVH pre-bake when vite.bvhPrebake is true)
useMeshCollider('./terrain.glb')

// Manual vertex data
useMeshCollider({ vertices: myFloat32Array, indices: myUint32Array })
```

#### useConvexCollider(options)

```ts
function useConvexCollider(options: {
  vertices: Float32Array
  isSensor?: boolean
  layer?: number | string | readonly (number | string)[]
  mask?: number | string | readonly (number | string)[]
  material?: string
}): { colliderId: number; remove(): void }
```

Adds a convex hull collider from a vertex cloud (`packages/physics3d/src/composables/use-convex-collider.ts:21`). Faster than a trimesh; suitable for dynamic bodies. A `.glb` path is not accepted.

```ts
useConvexCollider({ vertices: new Float32Array(12) })
```

### Events

Sensor callbacks registered inside an actor are dropped when that actor is destroyed. `onContact` stays until the function it returns runs, or until the plugin tears down.

#### onContact(callback)

```ts
function onContact(callback: (contact: CollisionContact) => void): () => void
```

Registers a callback for every contact on this engine. It is not limited to one actor. The callback receives `entityA`, `entityB`, optional `aColliderId` and `bColliderId`, and `started`.

```ts
import { onContact } from '@gwenjs/physics3d'

export const EnemyActor = defineActor(EnemyPrefab, () => {
  onContact((event) => {
    if (event.started) {
      console.log('Contact', event.entityA, event.entityB, event.aColliderId, event.bColliderId)
    }
  })
})
```

#### onSensorEnter(sensorId, callback)

```ts
function onSensorEnter(sensorId: number, callback: (entityId: bigint) => void): () => void
```

Called when an entity enters the sensor `sensorId`. Inside an actor the callback is stored for that actor. The return value removes the callback.

```ts
import { useStaticBody, useBoxCollider, onSensorEnter } from '@gwenjs/physics3d'

export const TriggerZone = defineActor(TriggerPrefab, () => {
  useStaticBody()
  const zone = useBoxCollider({ w: 3, h: 1, d: 3, isSensor: true })
  onSensorEnter(zone.colliderId, (entityId) => {
    console.log('Entity entered zone:', entityId)
  })
})
```

#### onSensorExit(sensorId, callback)

```ts
function onSensorExit(sensorId: number, callback: (entityId: bigint) => void): () => void
```

Called when an entity leaves the sensor `sensorId`. Same actor scope and return value as `onSensorEnter`.

### Layers

#### defineLayers(definition)

```ts
function defineLayers(definition: Record<string, number>): Record<string, number>
```

Returns a shallow copy of the mask map. When two values share bits, it writes a console warning. `defineLayers` works with masks while `Physics3DConfig.layers` takes bit indexes 0..31.

```ts
import { defineLayers } from '@gwenjs/physics3d'

const Layers = defineLayers({ default: 1, player: 2, enemy: 4 })
// Layers.default === 1, Layers.player === 2, Layers.enemy === 4

useBoxCollider({
  w: 1,
  h: 1,
  d: 1,
})
```

## Physics Service

### usePhysics3D()

```ts
function usePhysics3D(): Physics3DAPI
```

Returns the runtime physics API for imperative operations. Call inside `defineSystem` or `defineActor`.

```ts
import { usePhysics3D } from '@gwenjs/physics3d'

const physics = usePhysics3D()
physics.applyImpulse(entityId, { x: 0, y: 500, z: 0 })
```

### Physics3DAPI Methods

| Method | Signature | Description |
|---|---|---|
| `applyImpulse` | `(entityId: EntityId, impulse: Partial<Vec3>) => boolean` | Apply an instantaneous linear impulse (N·s) |
| `applyAngularImpulse` | `(entityId: EntityId, impulse: Partial<Vec3>) => boolean` | Apply an instantaneous angular impulse |
| `addForce` | `(entityId: EntityId, force: Partial<Vec3>) => void` | Accumulate a continuous force for this step (N) |
| `addTorque` | `(entityId: EntityId, torque: Partial<Vec3>) => void` | Accumulate a continuous torque for this step (N·m) |
| `setLinearVelocity` | `(entityId: EntityId, velocity: Partial<Vec3>) => boolean` | Override linear velocity (m/s) |
| `getLinearVelocity` | `(entityId: EntityId) => Vec3 \| undefined` | Read current linear velocity |
| `setAngularVelocity` | `(entityId: EntityId, velocity: Partial<Vec3>) => boolean` | Override angular velocity (rad/s) |
| `getAngularVelocity` | `(entityId: EntityId) => Vec3 \| undefined` | Read current angular velocity |
| `setGravityScale` | `(entityId: EntityId, scale: number) => void` | Override per-body gravity scale (`0` disables, `1` is normal) |
| `getGravityScale` | `(entityId: EntityId) => number` | Read current gravity scale for a body |
| `castRay` | `(origin: Vec3, direction: Vec3, maxDist: number, opts?) => RayHit \| null` | Cast a ray, returns nearest hit or `null` |

```ts
const physics = usePhysics3D()

// Jump
physics.applyImpulse(entityId, { x: 0, y: 300, z: 0 })

// Ground check
const hit = physics.castRay(
  { x: 0, y: 1, z: 0 },
  { x: 0, y: -1, z: 0 },
  1.1,
)
const isGrounded = hit !== null
```

## Events

### physics3d:body-disabled

The plugin emits this hook after a step that disabled a body. The payload is `{ entity, reason }`. `reason` is `non-finite`, `out-of-bounds`, or `velocity`. The body stays registered. A query or `getBodyState` still answers. A dynamic body and a body Rapier quarantines are both included (`crates/gwen-core/src/physics3d/world.rs:1021`).

```ts
engine.hooks.hook("physics3d:body-disabled", ({ entity, reason }) => {
  // reason is "non-finite", "out-of-bounds", or "velocity"
  void entity;
  void reason;
});
```

`non-finite` means a dynamic translation or linear velocity is not finite, or Rapier quarantined the body, including a kinematic target that is not finite. `out-of-bounds` means a dynamic position sits outside ±1e7. `velocity` means a dynamic position after the clamp would pass ±1e7.

The default cap of 400 m/s slows a faster dynamic body. A step delta above 1 s is refused with `PHYSICS3D:INVALID_STEP_DELTA`.

## Errors

A rejected `@gwenjs/physics3d` WASM call throws a `GwenWasmError`. `code` starts with `PHYSICS3D:` or is `CORE:INVALID_SHARED_BUFFER`, and `exportName` is the WASM export. `cause` is the original error. A trap throws `GwenWasmPanicError` and poisons the bridge. These errors are not emitted on the [error bus](/advanced/error-bus).

```ts
import { GwenWasmError } from '@gwenjs/core'

try {
  physics.addRevoluteJoint({ bodyA, bodyB })
} catch (err) {
  if (err instanceof GwenWasmError && err.code === 'PHYSICS3D:INVALID_JOINT') {
    // A joint value was NaN or infinite
  }
}
```

| Code | Raised when |
|---|---|
| `NOT_INITIALIZED` | An export touches the world before it is initialized |
| `BODY_NOT_FOUND` | No rigid body is registered for the slot |
| `BODY_ALREADY_EXISTS` | The slot already has a body. The first body is kept |
| `INVALID_BODY_KIND` | Body kind is not 0 (fixed), 1 (dynamic) or 2 (kinematic) |
| `BUFFER_LENGTH_MISMATCH` | Parallel buffers of a bulk call differ in length |
| `COLLIDER_NOT_FOUND` | No collider is registered for the slot and collider id |
| `COLLIDER_ALREADY_EXISTS` | The collider id is already registered for the slot |
| `INVALID_SHAPE` | Shape data cannot build a collider (mesh index out of range, heightfield too small or wrong sample count, convex hull with fewer than 4 points or degenerate) |
| `INVALID_MESH_BUFFER` | A mesh positions or indices length is not a multiple of 3 |
| `INVALID_COMPOUND` | A compound buffer length is not a multiple of 12, or a part has an unknown shape |
| `BVH_LOAD_FAILED` | A baked BVH is too short, has a bad header, was baked for another Rapier version, or does not decode to a valid mesh |
| `INVALID_COLLIDER` | A size, radius, offset, density or skin width is NaN, infinite, negative or too large |
| `JOINT_NOT_FOUND` | No joint is registered for the joint id |
| `INVALID_JOINT` | A joint anchor, axis, spring value, motor value or limit is NaN or infinite |
| `CHARACTER_CONTROLLER_NOT_FOUND` | No character controller is registered for the slot |
| `CHARACTER_CONTROLLER_LIMIT_REACHED` | All 32 character controller slots are in use |
| `NAVGRID_NOT_INITIALIZED` | A path query ran before the navigation grid was uploaded |
| `INVALID_NAVGRID` | A grid dimension is zero, the cell count overflows, the grid is above 64 cubed, or the number of cell bytes differs from the cell count |
| `INVALID_PATH_REQUEST` | A path coordinate is not finite or is past the accepted bound |
| `INVALID_QUERY` | A ray or point coordinate is not finite or sits outside ±1e7, a direction is not finite or is zero, or a max distance is not finite or is negative |
| `INVALID_STEP_DELTA` | A step `delta` is not finite or sits outside 0 to 1. The world is unchanged |

`findPath3D` is the one exception: with no navigation grid uploaded it returns an empty array instead of throwing `NAVGRID_NOT_INITIALIZED`.

A bulk read whose output pointer is not a live shared buffer throws `CORE:INVALID_SHARED_BUFFER`.

## Vite Integration

### physics3dVitePlugin(options?)

```ts
function physics3dVitePlugin(options?: GwenPhysics3DPluginOptions): VitePlugin
// import { physics3dVitePlugin } from '@gwenjs/physics3d/module'
```

Build-time Vite plugin. It is **auto-registered** by the `@gwenjs/physics3d` module — no manual registration is needed in most projects. Configure it via the `vite` key in the module options.

```ts
interface GwenPhysics3DPluginOptions {
  bvhPrebake?: boolean // default: false — pre-bake BVH for mesh collider paths
}
```

The plugin does two build-time jobs:

1. **Layer inlining** — registers `gwen:layer-inline` on `gwen:transform-pipeline`. `Layers.player` becomes its bitmask. A manual Vite config needs `gwen()` in the Vite config.
2. **BVH pre-baking** (opt-in) — `useMeshCollider('./terrain.glb')` (a `../` path too) is rewritten to `useMeshCollider({ __bvhUrl: "bvh-<hash>.bin" })`. The build emits that file. Dev serves the same bytes from memory. An absent file or a failed bake throws `VITE:BVH_PREBAKE_FAILED`. `useConvexCollider` is not rewritten.

:::tip BVH pre-bake workflow
Enable `bvhPrebake: true` (via `vite.bvhPrebake` in module config) for large terrain meshes. The BVH is compiled once at build time and served as a binary asset, so raycast initialisation at runtime is nearly instant — no per-frame BVH rebuild cost.
:::

## Type Definitions

### Physics3DConfig

```ts
interface Physics3DConfig extends PhysicsConfigBase<'3d'> {
  gravity?: Partial<Vec3>
  maxEntities?: number
  qualityPreset?: QualityPreset
  debug?: boolean
  coalesceEvents?: boolean
  maxLinearVelocity?: number
  layers?: Record<string, number>
  vite?: {
    bvhPrebake?: boolean
  }
}
```

Throughout this page, vector and rotation shapes are `Vec3` and `Quat` from `@gwenjs/math`, and entity ids are `EntityId` from `@gwenjs/schema`.

### QualityPreset

```ts
type QualityPreset = 'low' | 'medium' | 'high' | 'esport'
```

### DynamicBodyOptions3D

Fields copied onto the body: `mass?`, `gravityScale?`, `linearDamping?`, `angularDamping?`, `ccdEnabled?`, `initialPosition?` (`Partial<Vec3>`), `initialRotation?` (`Partial<Quat>`), `initialLinearVelocity?`, `initialAngularVelocity?`, `fixedRotation?`, `quality?` (`QualityPreset`). `layer`, `mask`, `material` and `isSensor` are on the type and are not copied. There is no `restitution` field.

### ColliderHandle3D

`useBoxCollider`, `useSphereCollider` and `useCapsuleCollider` return `BoxColliderHandle3D`, `SphereColliderHandle3D` and `CapsuleColliderHandle3D`. Each of those names is `ColliderHandle3D`: `colliderId` and `remove()`.

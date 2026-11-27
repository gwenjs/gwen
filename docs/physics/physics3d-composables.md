---
title: Physics 3D Composables
description: Composable-first API for 3D rigid body physics in GWEN using Rapier3D.
---

# Physics 3D Composables

**Package:** `@gwenjs/physics3d`

Physics 3D composables add rigid body dynamics and collision to actors in three-dimensional space. Like 2D, they're called inside `defineActor()` and work with the scene graph. 3D physics includes advanced features like raycasts, shape casts, and mesh colliders for complex environments.

```ts check
import { defineComponent, Types } from "@gwenjs/core";
import { defineActor, definePrefab } from "@gwenjs/core/actor";
import { useCapsuleCollider, useDynamicBody } from "@gwenjs/physics3d";
import type { CapsuleColliderHandle3D, DynamicBodyHandle3D } from "@gwenjs/physics3d";

const Position = defineComponent({
  name: "DocsPhysics3dComposablePos",
  schema: { x: Types.f32, y: Types.f32, z: Types.f32 },
  defaults: { x: 0, y: 0, z: 0 },
});

const HeroPrefab = definePrefab([{ def: Position, defaults: { x: 0, y: 0, z: 0 } }]);

export const HeroActor = defineActor(HeroPrefab, () => {
  const body: DynamicBodyHandle3D = useDynamicBody({ mass: 1, fixedRotation: true });
  const capsule: CapsuleColliderHandle3D = useCapsuleCollider({ radius: 0.4, height: 1.2 });
  void body;
  void capsule;
});
```

## The Basics

Declare 3D physics inside `defineActor()` — once per actor type:

```ts
import { defineActor, definePrefab } from '@gwenjs/core/actor'
import { onUpdate } from '@gwenjs/core/system'
import { onContact, useDynamicBody, useSphereCollider, useRaycast } from '@gwenjs/physics3d'

const BallPrefab = definePrefab([{ def: Position, defaults: { x: 0, y: 0, z: 0 } }])

export const BallActor = defineActor(BallPrefab, () => {
  const body = useDynamicBody({ mass: 2, ccdEnabled: true })
  useSphereCollider({ radius: 0.5 })

  onContact((contact) => {
    if (contact.started) {
      console.log('Contact', contact.entityA, contact.entityB)
    }
  })

  onUpdate(() => {
    // Update ball logic each frame
  })
})
```

The plugin automatically:
- Registers the body with the 3D physics simulation
- Syncs collider shapes and transforms
- Dispatches collision events
- Manages raycasts, shape casts, and overlaps per-frame
- Cleans up when the actor is despawned

`maxLinearVelocity` (default `400` m/s) sets GWEN's scale cap and Rapier's per-substep cap. A faster dynamic body is scaled and stays enabled. After a step that disables a body, the plugin emits `physics3d:body-disabled` with `{ entity, reason }`. That includes a dynamic body past the world and a body Rapier quarantines (`crates/gwen-core/src/physics3d/world.rs:1021`). `reason` is `non-finite`, `out-of-bounds`, or `velocity`. A step delta above 1 s is refused with `PHYSICS3D:INVALID_STEP_DELTA`. A query coordinate outside ±1e7 is refused with `PHYSICS3D:INVALID_QUERY`.

## Rapier 0.36

Rapier clamps linear speed after each solver substep. The default cap is 400 m/s. `maxLinearVelocity` sets GWEN's cap and that Rapier cap (`crates/gwen-core/src/physics2d/world.rs:752-753`, `crates/gwen-core/src/physics3d/world.rs:809-810`). A new world starts at 400 (`crates/gwen-core/src/physics2d/world.rs:200`, `crates/gwen-core/src/physics3d/world.rs:714`). A value that is not finite, or that is zero or negative, is refused and both caps stay.

A body falls asleep after half a second below the sleep threshold (`rapier3d-0.36.1/src/dynamics/rigid_body_components.rs:1375`, `crates/gwen-core/tests/physics3d_rapier_036.rs:333`). An island sleeps once every body in it is eligible (`crates/gwen-core/tests/physics3d_rapier_036.rs:356`).

With one CCD substep, a fast dynamic box does not pass through a thin fixed wall even when its own CCD flag is off (`crates/gwen-core/tests/physics2d_rapier_036.rs:241`). The Low preset keeps that one substep (`crates/gwen-core/src/physics_common/quality.rs:43-47`). Zero substeps turns this CCD off, and the same box passes the wall (`crates/gwen-core/src/physics2d/world.rs:1711`).

Extra solver iterations add substeps for the whole island that contains the body. In 2D, `additionalSolverIterations` is stored at 16 or below (`packages/physics2d/src/types/api.ts:71`, `crates/gwen-core/src/physics2d/world.rs:19`, `crates/gwen-core/src/physics2d/world.rs:252`). In 3D, `set_body_solver_iterations` uses the same cap of 0–16 (`crates/gwen-core/src/physics3d/world.rs:341`, `crates/gwen-core/src/physics3d/world.rs:2805-2807`). 0 adds no extra substeps. 17 and above are stored as 16. The physics3d plugin invokes `physics3d_set_body_solver_iterations` only when the mapped count is above 0 (`packages/physics3d/src/plugin/body-management.ts:277-280`).

## Bodies

Each actor needs exactly one body composable:

| Composable | Use case |
|---|---|
| `useDynamicBody(opts?)` | Fully simulated: gravity, forces, collisions. Characters, vehicles, interactive objects. |
| `useKinematicBody(opts?)` | Manually driven: moves on command, doesn't respond to forces. Elevators, sliding doors, moving platforms. |
| `useStaticBody()` | Never moves: terrain, walls, immovable structures. |

```ts
// Falling crate in 3D
const CrateActor = defineActor(CratePrefab, () => {
  useDynamicBody({ mass: 10, linearDamping: 0.2 })
  useBoxCollider({ w: 1, h: 1, d: 1 })
})

// Elevator moving on a track
const ElevatorActor = defineActor(ElevatorPrefab, () => {
  const body = useKinematicBody()
  useBoxCollider({ w: 4, h: 0.5, d: 4 })

  let elapsed = 0
  onUpdate((dt) => {
    elapsed += dt
    const y = Math.sin(elapsed) * 5
    body.moveTo(0, y, 0)
  })
})

// Terrain (terrain can use mesh colliders for efficiency)
const TerrainActor = defineActor(TerrainPrefab, () => {
  useStaticBody()
  useMeshCollider({ vertices: terrainVerts, indices: terrainIndices })
})
```

## Colliders

Add collision shapes with collider composables. An actor can have multiple colliders:

| Composable | Shape | Best For |
|---|---|---|
| `useBoxCollider(opts)` | Axis-aligned box | Crates, buildings, simple structures |
| `useSphereCollider(opts)` | Sphere | Balls, explosions, round objects |
| `useCapsuleCollider(opts)` | Capsule (rounded cylinder) | Characters, smooth movement |
| `useConvexCollider(opts)` | Convex hull of vertices | Irregular shapes (rocks, asteroids) |
| `useCompoundCollider(opts)` | Multiple shapes combined | Complex objects (robots, vehicles) |
| `useMeshCollider(opts)` | Triangle mesh (concave) | Terrain, environment (static bodies only) |
| `useHeightfieldCollider(opts)` | Height grid | Terrain from heightmaps |

```ts
// Character with capsule
const CharacterActor = defineActor(CharacterPrefab, () => {
  useDynamicBody({ mass: 1 })
  useCapsuleCollider({ radius: 0.4, height: 1.8 })
})

// Asteroid with convex hull
const AsteroidActor = defineActor(AsteroidPrefab, () => {
  useDynamicBody({ mass: 5 })
  useConvexCollider({
    vertices: asteroidVertices,
    offsetX: 0, offsetY: 0, offsetZ: 0
  })
})

// Robot with compound collider (head + body + legs)
const RobotActor = defineActor(RobotPrefab, () => {
  useDynamicBody({ mass: 50 })
  useCompoundCollider({
    shapes: [
      { type: "box", halfX: 0.5, halfY: 1, halfZ: 0.5, offsetY: 0.5 },
      { type: "sphere", radius: 0.5, offsetY: 2 },
      { type: "capsule", radius: 0.2, halfHeight: 0.5, offsetY: -0.5 },
    ]
  })
})

// Terrain with mesh collider (preloaded BVH for efficiency)
const TerrainActor = defineActor(TerrainPrefab, () => {
  useStaticBody()
  const mesh = useMeshCollider('./terrain.glb')
  ready.then(() => console.log('Terrain collider loaded'))
})
```

### Collider Options

**Box, sphere, and capsule accept:**
- `offsetX?: number`, `offsetY?: number`, `offsetZ?: number` — Local position offset
- `isSensor?: boolean` — Overlap events only, no physical response
- `layer?: number | string | Array<number | string>` — Membership. A number is a raw bitmask. A string is a bit name from `Physics3DConfig.layers`. An array is OR-ed.
- `mask?: number | string | Array<number | string>` — Collision filter. Same shapes as `layer`.
- `material?: string` — Preset name: `default`, `ice`, `rubber`, or `metal`. An unknown name throws `PHYSICS3D:UNKNOWN_MATERIAL`. Resolved on the WASM backend only.

**Convex** accepts `isSensor`, `layer`, `mask`, and `material` with the same meaning. It has no position offset.

**Heightfield** accepts `layer`, `mask`, and `material` with the same meaning. It has no `isSensor` and no position offset.

**Mesh** accepts `offsetX`, `offsetY`, `offsetZ`, `isSensor`, `layer`, and `mask` with the same meaning. It has no `material`.

**Compound** accepts `layer` and `mask` with the same meaning, shared by every shape. It has no `material`. Each shape in `shapes` has its own offset and `isSensor`.

**Box collider:**
- `w: number` — Width (X)
- `h: number` — Height (Y)
- `d?: number` — Depth (Z). Defaults to `w`

**Sphere & Capsule:**
- `radius: number` — Radius

**Capsule:**
- `height: number` — Cylinder length. The stored half-height is `height / 2`. `axis` is accepted and not applied

**Convex collider:**
- `vertices: Float32Array` — Vertex positions [x, y, z, x, y, z, ...]

**Mesh collider (concave):**
- `vertices?: Float32Array` — Vertex positions
- `indices?: Uint32Array` — Triangle indices
- `__bvhUrl?: string` — URL to pre-baked BVH (async, recommended)

**Heightfield collider:**
- `heights: Float32Array` — Height values in a grid
- `scale: Vec3` — Scale of the heightfield in X, Y, Z

## Events

### Contact Events

```ts
onContact((contact) => {
  if (contact.started) {
    console.log('Entities:', contact.entityA, contact.entityB)
    console.log('Colliders:', contact.aColliderId, contact.bColliderId)
  }
})
```

`contact` object:
- `entityA` — Packed entity id of the first participant
- `entityB` — Packed entity id of the second participant
- `aColliderId` — Collider id on A when present
- `bColliderId` — Collider id on B when present
- `started` — `true` when the contact started this frame, `false` when it ended

### Sensor Events

```ts
const sensor = useBoxCollider({ w: 2, h: 2, d: 2, isSensor: true })

onSensorEnter(sensor.colliderId, (entityId) => {
  console.log('Entity entered:', entityId)
})

onSensorExit(sensor.colliderId, (entityId) => {
  console.log('Entity left:', entityId)
})
```

## Queries

### Raycasts

Cast rays for hit detection (ground checks, line-of-sight, etc.):

```ts
const groundRay = useRaycast({
  origin: () => ({ x: player.x, y: player.y + 0.1, z: player.z }),
  direction: { x: 0, y: -1, z: 0 },
  maxDist: 0.5,
  layer: Layers.player,
  mask: Layers.terrain
})

onUpdate(() => {
  if (groundRay.hit) {
    console.log('On ground, distance:', groundRay.distance)
    console.log('Hit point:', groundRay.point)
  }
  
  // Call dispose() when done (if the raycast was temporary)
  // groundRay.dispose()
})
```

Raycast options:
- `origin?: () => Vec3` — Origin function (updated each frame)
- `direction: Vec3` — Ray direction (normalized)
- `maxDist: number` — Max distance to search
- `layer?: number` — Membership layer
- `mask?: number` — Filter mask
- `solid?: boolean` — Skip sensors (default: false)

Raycast handle:
- `get hit(): boolean` — Whether the ray hit something
- `get entity(): bigint | null` — Hit entity ID
- `get distance(): number` — Distance to hit point
- `get point(): Vec3` — Hit point in world space
- `get normal(): Vec3` — Surface normal at hit point
- `dispose(): void` — Unregister the raycast slot

### Shape Casts

Cast a shape (box, sphere, capsule) to check for collisions along a path:

```ts
const sweep = useShapeCast({
  shape: { type: 'sphere', radius: 0.5 },
  origin: { x: 0, y: 1, z: 0 },
  direction: { x: 1, y: 0, z: 0 },
  maxDist: 10,
  mask: Layers.terrain | Layers.enemy
})

onUpdate(() => {
  if (sweep.hit) {
    console.log('Obstacle ahead at distance:', sweep.distance)
  }
})
```

### Overlaps

Check what's currently overlapping a shape:

```ts
const explosionZone = useOverlap({
  shape: { type: 'sphere', radius: 5 },
  position: explosionPos,
  layer: Layers.projectile,
  mask: Layers.enemy | Layers.player
})

onUpdate(() => {
  explosionZone.entities.forEach((entityId) => {
    console.log('Entity in blast radius:', entityId)
  })
})
```

## Joints

Connect two bodies with physics constraints:

```ts
const anchorBody = useDynamicBody()
const swingBody = useDynamicBody()

useJoint({
  bodyA: anchorBody.bodyId,
  bodyB: swingBody.bodyId,
  type: 'revolute',  // revolute, spherical, prismatic, fixed, rope, etc.
  anchorA: { x: 0, y: 1, z: 0 },
  anchorB: { x: 0, y: -1, z: 0 },
  limits: { min: -Math.PI / 2, max: Math.PI / 2 }
})
```

Joint types:
- `'fixed'` — Rigidly connect two bodies
- `'revolute'` — Hinge joint (rotation around axis)
- `'spherical'` — Ball joint (free rotation)
- `'prismatic'` — Slider joint (linear motion)
- `'rope'` — Distance constraint
- etc.

A joint with a NaN or infinite anchor, axis, spring, motor value or limit throws `PHYSICS3D:INVALID_JOINT`. See [Errors](/api/physics3d#errors).

## Collision Layers

A collider `layer` or `mask` is a number, a string, or an array. A number is a raw bitmask. A string is a bit name from `Physics3DConfig.layers` (the value there is a bit index, and the mask is `1 << index`). An array is OR-ed. An omitted filter, or an empty array, is every bit.

`defineLayers` returns a shallow copy of the mask map you pass (bitmasks such as `1 << 0`), ready to use as a numeric `layer` or `mask`.

Use layers to control which objects collide:

```ts
import { defineLayers } from '@gwenjs/physics3d'

export const Layers = defineLayers({
  player:    1 << 0,
  enemy:     1 << 1,
  terrain:   1 << 2,
  projectile: 1 << 3,
  debris:    1 << 4,
})

// Player collides with terrain only
const PlayerActor = defineActor(PlayerPrefab, () => {
  useDynamicBody()
  useCapsuleCollider({
    radius: 0.4, height: 1.8,
    layer: Layers.player,
    mask: Layers.terrain
  })
})

// Projectile collides with everything except other projectiles
const ProjectileActor = defineActor(ProjectilePrefab, () => {
  useDynamicBody()
  useSphereCollider({
    radius: 0.1,
    layer: Layers.projectile,
    mask: Layers.player | Layers.enemy | Layers.terrain | Layers.debris
  })
})
```

## In Practice

### 3D Character Controller

A complete example: character with gravity, ground detection via raycast, and jumping.

```ts
import { defineActor } from '@gwenjs/core/actor'
import { useComponent } from '@gwenjs/core/system'
import { useService } from '@gwenjs/core/system'
import { onUpdate } from '@gwenjs/core/system'
import { useDynamicBody, useCapsuleCollider, useRaycast } from '@gwenjs/physics3d'
import { Position } from './components'
import { Layers } from './layers'

export const PlayerActor = defineActor(PlayerPrefab, () => {
  // Read entity position each frame (physics3d writes to this component)
  const pos = useComponent(Position)

  // input comes from your input plugin (registered via engine.provide)
  const input = useService('input')

  const body = useDynamicBody({ mass: 1, gravityScale: 2, linearDamping: 0.1 })

  useCapsuleCollider({
    radius: 0.4,
    height: 1.8,
    offsetY: 0.9,
    layer: Layers.player,
    mask: Layers.terrain | Layers.enemy,
  })

  // Ground detection: origin tracks the entity's feet each frame
  const groundRay = useRaycast({
    origin: () => ({ x: pos.x, y: pos.y - 0.9, z: pos.z }),
    direction: { x: 0, y: -1, z: 0 },
    maxDist: 0.1,
    mask: Layers.terrain,
  })

  onUpdate((dt) => {
    const grounded = groundRay.hit

    const forward = input.axis('forward') ?? 0  // W/S
    const right = input.axis('right') ?? 0      // A/D

    const vel = body.velocity
    body.setVelocity(right * 5, vel.y, forward * 10)

    if (input.justPressed('Space') && grounded) {
      body.applyImpulse(0, 10, 0)
    }
  })
})
```

### Mesh Colliders with BVH

For complex terrain, use pre-baked BVH for efficiency:

```ts
// gwen.config.ts — enable BVH pre-baking via the module vite sub-key
export default defineConfig({
  modules: ['@gwenjs/physics3d'],
  physics3d: { vite: { bvhPrebake: true } },
})

// In actor — the Vite plugin rewrites the path to a pre-baked BVH handle at build time
const TerrainActor = defineActor(TerrainPrefab, () => {
  useStaticBody()
  useMeshCollider('./models/terrain.glb')  // path is replaced by the Vite plugin
})
```

## Deep Dive

### Body Options

**Dynamic body:**
- `mass?: number` — Mass in kg (default: 1)
- `gravityScale?: number` — Gravity multiplier (default: 1)
- `linearDamping?: number` — Velocity damping (default: 0)
- `angularDamping?: number` — Rotation damping (default: 0)
- `ccdEnabled?: boolean` — Continuous collision detection (default: false)
- `fixedRotation?: boolean` — Lock rotation (default: false)
- `initialPosition?: Partial<Vec3>` — Starting position
- `initialRotation?: Partial<Quat>` — Starting rotation
- `initialLinearVelocity?: Partial<Vec3>` — Starting velocity
- `initialAngularVelocity?: Partial<Vec3>` — Starting angular velocity
- `quality?: QualityPreset` — `'low'`, `'medium'`, `'high'`, or `'esport'` (default: `'medium'`)
- `layer?`, `mask?`, `material?`, `isSensor?` — On the type and not copied onto the body

**Kinematic body:**
- `initialPosition?: Vec3`
- `initialRotation?: Quat`
- `fixedRotation?` — When true, angular velocity calls are ignored

`useStaticBody` accepts `StaticBodyOptions3D` (`isSensor`, `layer`, `mask`, `material`) and does not read those fields.

### Applying Forces

Dynamic bodies have multiple ways to apply forces:

```ts
const body = useDynamicBody()

// Set velocity directly (m/s)
body.setVelocity(5, 0, 0)

// Apply impulse (N·s) — instantaneous velocity change
body.applyImpulse(0, 10, 0)

// Apply force (N) — newtons, applied as force × dt each frame. Call it every frame.
// A force applied in `onUpdate` is flushed on the next frame, after that frame's physics step.
body.applyForce(0, 20, 0)

// Apply torque (N·m) — rotational force
body.applyTorque(1, 0, 0)

// Current velocity and angular velocity
const vel = body.velocity
const angVel = body.angularVelocity
```

### Preloading Mesh Colliders

For large mesh colliders, preload the BVH to avoid stutters during gameplay:

```ts
import { preloadMeshCollider } from '@gwenjs/physics3d'

// The call needs a current engine. Outside one it throws
// GwenContextError OUTSIDE_ENGINE.
const terrainBvh = engine.run(() => preloadMeshCollider('./models/terrain.glb'))
await terrainBvh.ready

// Later, in an actor:
const TerrainActor = defineActor(TerrainPrefab, () => {
  useStaticBody()
  useMeshCollider(terrainBvh)  // No async wait needed
})
```

## API Summary

### Composables

| Function | Returns | Purpose |
|---|---|---|
| `useStaticBody(opts?)` | `StaticBodyHandle3D` | Static (immovable) body. Options are not read. |
| `useDynamicBody(opts?)` | `DynamicBodyHandle3D` | Fully simulated body. |
| `useKinematicBody(opts?)` | `KinematicBodyHandle3D` | Manually driven body. |
| `useBoxCollider(opts)` | `BoxColliderHandle3D` | Box-shaped collider. |
| `useSphereCollider(opts)` | `SphereColliderHandle3D` | Sphere collider. |
| `useCapsuleCollider(opts)` | `CapsuleColliderHandle3D` | Capsule collider. |
| `useConvexCollider(opts)` | `ConvexColliderHandle3D` | Convex hull collider. |
| `useCompoundCollider(opts)` | `CompoundColliderHandle3D` | Multiple shapes combined. |
| `useMeshCollider(opts)` | `MeshColliderHandle3D` | Triangle mesh collider. |
| `useHeightfieldCollider(opts)` | `HeightfieldColliderHandle3D` | Heightfield collider. |
| `useRaycast(opts)` | `UseRaycastHandle` | Per-frame raycast query. |
| `useShapeCast(opts)` | `UseShapeCastHandle` | Per-frame shape sweep. |
| `useOverlap(opts)` | `UseOverlapHandle` | Per-frame overlap check. |
| `useJoint(opts)` | `UseJointHandle` | Physics constraint joint. |
| `defineLayers(def)` | `Record<string, number>` | Named collision layers. |

### Event Handlers

| Function | Callback Signature | Purpose |
|---|---|---|
| `onContact(callback)` | `(contact: CollisionContact) => void` | Every contact on this engine. Returns `() => void`. |
| `onSensorEnter(sensorId, cb)` | `(entityId: bigint) => void` | Sensor entry. |
| `onSensorExit(sensorId, cb)` | `(entityId: bigint) => void` | Sensor exit. |

### Body Handle Methods

**DynamicBodyHandle3D:**
- `get velocity(): Vec3` — Current linear velocity.
- `get angularVelocity(): Vec3` — Current angular velocity.
- `setVelocity(vx, vy, vz): void` — Set velocity.
- `applyForce(fx, fy, fz): void` — Newtons, applied as force × dt each frame. Call it every frame. A force applied in `onUpdate` is flushed on the next frame, after that frame's physics step.
- `applyImpulse(ix, iy, iz): void` — Apply instantaneous impulse.
- `applyTorque(tx, ty, tz): void` — Apply rotational force.
- `enable(): void` — Re-enable if disabled.
- `disable(): void` — Remove from simulation.
- `get active(): boolean` — Whether body is active.
- `get bodyId(): number` — Unique identifier.

**KinematicBodyHandle3D:** Similar, but without force/impulse/torque methods.

### Types

- `Vec3` — `{ x: number, y: number, z: number }`
- `CollisionContact` — `{ entityA: bigint, entityB: bigint, aColliderId?: number, bColliderId?: number, started: boolean }`
- Various collider handles with `colliderId`, `isSensor`, `remove()`, etc.
- `UseRaycastHandle` — Hit properties and `dispose()`
- `UseShapeCastHandle` — Similar to raycast
- `UseOverlapHandle` — `entities: bigint[]`
- `UseJointHandle` — `remove(): void`

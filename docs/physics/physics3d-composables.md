---
title: Physics 3D Composables
description: Composable-first API for 3D rigid body physics in GWEN using Rapier3D.
---

# Physics 3D Composables

**Package:** `@gwenjs/physics3d`

Physics 3D composables add rigid body dynamics and collision to actors in three-dimensional space. Like 2D, they're called inside `defineActor()` and work with the scene graph. 3D physics includes advanced features like raycasts, shape casts, and mesh colliders for complex environments.

## The Basics

Declare 3D physics inside `defineActor()` — once per actor type:

```ts
import { defineActor } from '@gwenjs/core/actor'
import { onUpdate, onContact } from '@gwenjs/core/system'
import { useDynamicBody, useSphereCollider, useRaycast } from '@gwenjs/physics3d'

export const BallActor = defineActor(BallPrefab, () => {
  const body = useDynamicBody({ mass: 2, ccdEnabled: true })
  useSphereCollider({ radius: 0.5 })

  onContact((contact) => {
    console.log('Hit something:', contact.other)
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
  useCapsuleCollider({ radius: 0.4, length: 1.8 })
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
      { type: 'box', w: 1, h: 2, d: 1, offsetY: 0.5 },    // body
      { type: 'sphere', radius: 0.5, offsetY: 2 },         // head
      { type: capsule', radius: 0.2, length: 1, offsetY: -0.5 } // legs
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

**All colliders accept:**
- `offsetX?: number`, `offsetY?: number`, `offsetZ?: number` — Local position offset
- `isSensor?: boolean` — Overlap events only, no physical response
- `layer?: number` — Membership layer bitmask
- `mask?: number` — Collision filter mask

**Box collider:**
- `w: number` — Width (X)
- `h: number` — Height (Y)
- `d: number` — Depth (Z)

**Sphere & Capsule:**
- `radius: number` — Radius

**Capsule:**
- `length: number` — Length of the cylindrical section

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
  console.log('Hit:', contact.other)
  console.log('Speed:', contact.relativeVelocity)
  console.log('Point:', contact.point)
  console.log('Normal:', contact.normal)
})
```

`contact` object:
- `other` — Entity ID of the colliding entity
- `relativeVelocity` — Relative speed at collision
- `point` — Collision point in world space
- `normal` — Surface normal

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

## Collision Layers

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
    radius: 0.4, length: 1.8,
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
import { defineActor, useComponent, useService } from '@gwenjs/core/actor'
import { onUpdate } from '@gwenjs/core/system'
import { useDynamicBody, useCapsuleCollider, useRaycast } from '@gwenjs/physics3d'
import { Position } from './components'
import { Layers } from './layers'

export const PlayerActor = defineActor(PlayerPrefab, () => {
  // Read entity position each frame (physics3d writes to this component)
  const pos = useComponent<{ x: number; y: number; z: number }>(Position)

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
  modules: [
    ['@gwenjs/physics3d', { vite: { bvhPrebake: true } }],
  ],
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
- `linearDamping?: number` — Velocity damping (default: 0.1)
- `angularDamping?: number` — Rotation damping (default: 0.1)
- `ccdEnabled?: boolean` — Continuous collision detection (default: false)
- `fixedRotation?: boolean` — Lock rotation (default: false)
- `initialPosition?: Vec3` — Starting position
- `initialRotation?: Quat` — Starting rotation (quaternion)
- `initialLinearVelocity?: Vec3` — Starting velocity
- `initialAngularVelocity?: Vec3` — Starting angular velocity
- `quality?: 'fast' | 'medium' | 'high'` — Solver quality (default: 'medium')

**Kinematic body:**
- `initialPosition?: Vec3`
- `initialRotation?: Quat`

### Applying Forces

Dynamic bodies have multiple ways to apply forces:

```ts
const body = useDynamicBody()

// Set velocity directly (m/s)
body.setVelocity(5, 0, 0)

// Apply impulse (N·s) — instantaneous velocity change
body.applyImpulse(0, 10, 0)

// Apply force (N) — continuous
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

// During app initialization:
const terrainBvh = await preloadMeshCollider('./models/terrain.glb')

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
| `useStaticBody()` | `void` | Static (immovable) body. |
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
| `onContact(callback)` | `(contact: ContactEvent3D) => void` | Collision event. |
| `onSensorEnter(sensorId, cb)` | `(entityId: bigint) => void` | Sensor entry. |
| `onSensorExit(sensorId, cb)` | `(entityId: bigint) => void` | Sensor exit. |

### Body Handle Methods

**DynamicBodyHandle3D:**
- `get velocity(): Vec3` — Current linear velocity.
- `get angularVelocity(): Vec3` — Current angular velocity.
- `setVelocity(vx, vy, vz): void` — Set velocity.
- `applyForce(fx, fy, fz): void` — Apply continuous force.
- `applyImpulse(ix, iy, iz): void` — Apply instantaneous impulse.
- `applyTorque(tx, ty, tz): void` — Apply rotational force.
- `enable(): void` — Re-enable if disabled.
- `disable(): void` — Remove from simulation.
- `get active(): boolean` — Whether body is active.
- `get bodyId(): number` — Unique identifier.

**KinematicBodyHandle3D:** Similar, but without force/impulse/torque methods.

### Types

- `Vec3` — `{ x: number, y: number, z: number }`
- `ContactEvent3D` — `{ other: bigint, relativeVelocity: number, point: Vec3, normal: Vec3 }`
- Various collider handles with `colliderId`, `isSensor`, `remove()`, etc.
- `UseRaycastHandle` — Hit properties and `dispose()`
- `UseShapeCastHandle` — Similar to raycast
- `UseOverlapHandle` — `entities: bigint[]`
- `UseJointHandle` — `remove(): void`

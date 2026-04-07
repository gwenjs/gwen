---
title: Physics 2D Composables
description: Composable-first API for 2D rigid body physics in GWEN using Rapier2D.
---

# Physics 2D Composables

**Package:** `@gwenjs/physics2d`

Physics composables are composable functions called inside `defineActor()` that add rigid body dynamics and collision to actors. They work seamlessly with the scene graph—each actor gets its own physics body, and events like collisions are dispatched per-entity.

## Module Configuration

All options are passed as the second element of the module tuple in `gwen.config.ts`:

```typescript
// gwen.config.ts
export default defineConfig({
  modules: [
    ['@gwenjs/physics2d', {
      gravity: -9.81,
      qualityPreset: 'medium',
    }]
  ],
})
```

| Option | Type | Default | Description |
|---|---|---|---|
| `gravity` | `number` | `-9.81` | Vertical gravity (Y axis, m/s²) |
| `gravityX` | `number` | `0` | Horizontal gravity (X axis, m/s²) |
| `maxEntities` | `number` | `10_000` | Max physics entities |
| `qualityPreset` | `'low' \| 'medium' \| 'high' \| 'esport'` | `'medium'` | Physics quality preset |
| `eventMode` | `'pull' \| 'hybrid'` | `'pull'` | Collision event read mode |
| `coalesceEvents` | `boolean` | `true` | Merge duplicate collision events |
| `ccdEnabled` | `boolean` | auto | Continuous collision detection (auto-enabled at `'high'`/`'esport'`) |
| `layers` | `Record<string, number>` | `{}` | Collision layers (bit index 0–31) |
| `debug` | `boolean` | `false` | Enable debug renderer |

### Collision Layers

```typescript
export default defineConfig({
  modules: [
    ['@gwenjs/physics2d', {
      layers: {
        player:  0,
        enemy:   1,
        terrain: 2,
        sensor:  3,
      }
    }]
  ],
})
```

Use `defineLayers()` inside a system or actor to build bitmask filters:

```typescript
const layers = defineLayers({ player: 0, enemy: 1, terrain: 2 })
// layers.player === 0b001, layers.enemy === 0b010, etc.
```

## The Basics

Declare physics inside `defineActor()` — once per actor type. Composables read actor context automatically.

```ts
import { defineActor } from '@gwenjs/core/actor'
import { onUpdate, onContact } from '@gwenjs/core/system'
import { useShape, useDynamicBody, useBoxCollider } from '@gwenjs/physics2d'

export const PlayerActor = defineActor('Player', () => {
  useShape({ w: 32, h: 48 })
  useDynamicBody({ gravityScale: 1 })
  useBoxCollider({ w: 32, h: 48 })

  onContact((contact) => {
    if (contact.relativeVelocity > 50) {
      console.log('Hit something hard!')
    }
  })

  onUpdate(() => {
    // Update player logic each frame
  })
})
```

The module automatically:
- Registers the body with the physics simulation
- Syncs collider shapes to the body
- Dispatches collision events to subscribed callbacks
- Cleans up when the actor is despawned

## Bodies

Each actor needs exactly one body composable. Choose based on how the body should move:

| Composable | Use case |
|---|---|
| `useDynamicBody(opts?)` | Fully simulated: affected by gravity, forces, and collisions. Use for characters, objects, projectiles. |
| `useKinematicBody(opts?)` | Manually driven: moves on command, pushing dynamic bodies. Use for platforms, elevators, sliding doors. |
| `useStaticBody()` | Never moves: anchored in space. Use for terrain, walls, immovable obstacles. |

```ts
// Fully simulated falling crate
const CrateActor = defineActor('Crate', () => {
  useDynamicBody({ mass: 5, linearDamping: 0.1 })
  useBoxCollider({ w: 32, h: 32 })
})

// Platform that moves on command
const PlatformActor = defineActor('Platform', () => {
  const body = useKinematicBody()
  useBoxCollider({ w: 128, h: 16 })
  onUpdate(({ dt }) => {
    body.setVelocity(50, 0) // Move right at constant velocity
  })
})

// Immovable ground
const GroundActor = defineActor('Ground', () => {
  useStaticBody()
  useBoxCollider({ w: 1024, h: 32 })
})
```

## Colliders

Add collision shapes to a body with a collider composable. An actor can have multiple colliders for complex shapes.

| Composable | Shape |
|---|---|
| `useBoxCollider(opts)` | Axis-aligned rectangle. Great for characters, crates, platforms. |
| `useCapsuleCollider(opts)` | Capsule (rounded rectangle). Ideal for smooth character collisions. |
| `useSphereCollider(opts)` | Circle. Perfect for balls, explosions, round obstacles. |

```ts
// Character with capsule collider
const CharacterActor = defineActor('Character', () => {
  useDynamicBody({ mass: 1, gravityScale: 1 })
  useCapsuleCollider({ radius: 0.5, length: 2 })
})

// Ball with sensor (overlap-only) collider
const BallActor = defineActor('Ball', () => {
  useDynamicBody({ mass: 0.5 })
  useSphereCollider({ radius: 0.25, isSensor: true })
})
```

### Collider Options

**All colliders accept:**
- `offsetX?: number` — Local X offset from actor origin (default: 0)
- `offsetY?: number` — Local Y offset from actor origin (default: 0)
- `isSensor?: boolean` — Generates overlap events with no physical response (default: false)
- `layer?: number` — Membership layer bitmask (see Collision Layers below)
- `mask?: number` — Collision filter mask (see Collision Layers below)

**Box collider:**
- `w: number` — Width in world units
- `h: number` — Height in world units

**Capsule collider:**
- `radius: number` — Radius in world units
- `length: number` — Length (height) in world units

**Sphere collider:**
- `radius: number` — Radius in world units

## Events

### Contact Events

Subscribe to collision contact events with `onContact()`:

```ts
onContact((contact) => {
  console.log('Entity collided:', contact.other)
  console.log('Relative velocity:', contact.relativeVelocity)
  console.log('Normal:', contact.normal)
})
```

The `contact` object has:
- `other` — Entity ID of the colliding entity
- `relativeVelocity` — Speed at which the two bodies collide
- `normal` — Normal vector of the collision surface

### Sensor Events

For sensors (colliders with `isSensor: true`), use `onSensorEnter` and `onSensorExit`:

```ts
const damageZone = useBoxCollider({ w: 64, h: 64, isSensor: true })

onSensorEnter(damageZone.colliderId, (entityId) => {
  console.log('Entity entered damage zone:', entityId)
})

onSensorExit(damageZone.colliderId, (entityId) => {
  console.log('Entity left damage zone:', entityId)
})
```

## Collision Layers

Use layers to selectively enable/disable collisions between types of objects:

```ts
import { defineLayers } from '@gwenjs/physics2d'

export const Layers = defineLayers({
  player:   1 << 0,  // bit 0
  enemy:    1 << 1,  // bit 1
  terrain:  1 << 2,  // bit 2
  projectile: 1 << 3, // bit 3
})

// Player collides with terrain only (not enemies)
const PlayerActor = defineActor('Player', () => {
  useDynamicBody()
  useBoxCollider({
    w: 32, h: 48,
    layer: Layers.player,
    mask: Layers.terrain  // Only collides with terrain
  })
})

// Enemy collides with terrain and projectiles (not player)
const EnemyActor = defineActor('Enemy', () => {
  useDynamicBody()
  useBoxCollider({
    w: 24, h: 24,
    layer: Layers.enemy,
    mask: Layers.terrain | Layers.projectile
  })
})

// Projectile collides with everything except other projectiles
const ProjectileActor = defineActor('Projectile', () => {
  useDynamicBody()
  useSphereCollider({
    radius: 4,
    layer: Layers.projectile,
    mask: Layers.player | Layers.enemy | Layers.terrain
  })
})
```

## In Practice

### Platformer Character

Here's a common pattern: a character that falls with gravity, collides with terrain, and can jump when touching the ground.

```ts
import { defineActor } from '@gwenjs/core/actor'
import { onUpdate, onContact } from '@gwenjs/core/system'
import { useDynamicBody, useCapsuleCollider } from '@gwenjs/physics2d'

export const PlayerActor = defineActor('Player', () => {
  const body = useDynamicBody({
    mass: 1,
    gravityScale: 3,
    linearDamping: 0.2
  })

  useCapsuleCollider({
    radius: 0.4,
    length: 1.8,
    layer: Layers.player,
    mask: Layers.terrain
  })

  let grounded = false

  onContact((contact) => {
    // Simple ground detection: any collision counts as grounded
    // (In production, check the collision normal for better accuracy)
    grounded = true
  })

  onUpdate(({ input }) => {
    // Movement
    if (input.pressed('ArrowLeft')) {
      body.setVelocity(-8, body.velocity.y)
    } else if (input.pressed('ArrowRight')) {
      body.setVelocity(8, body.velocity.y)
    }

    // Jump
    if (input.justPressed('Space') && grounded) {
      body.applyImpulse(0, 500)
      grounded = false
    }
  })
})
```

## Deep Dive

### Body Options

**Dynamic body options:**
- `mass?: number` — Mass in kg (default: 1)
- `gravityScale?: number` — Gravity multiplier (default: 1)
- `linearDamping?: number` — Linear velocity damping (default: 0.1)
- `angularDamping?: number` — Angular velocity damping (default: 0.1)
- `fixedRotation?: boolean` — Prevent rotation (warning: not yet supported)

**Kinematic body options:**
- `layer?: number` — Membership layer (for interactions with dynamic bodies)
- `mask?: number` — Collision filter mask

**Static bodies** accept no options—they're infinitely massive and never move.

### Applying Forces

For dynamic bodies, use the handle returned by `useDynamicBody`:

```ts
const body = useDynamicBody()

// Set velocity directly (m/s)
body.setVelocity(10, 0)

// Apply an instantaneous impulse (N·s)
body.applyImpulse(0, 500)

// Note: applyForce is a no-op in Rapier2D; use impulses instead
body.applyForce(0, 100)  // This has no effect
```

### Shape Component

The `useShape()` composable sets shared dimensions that other systems can read:

```ts
useShape({ w: 32, h: 48 })
```

Renderers and other composables can read these dimensions without duplicating data:

```ts
// Later, a sprite renderer can use the same dimensions
useSprite({ texture: 'player', width: 32, height: 48 })
```

### Enabling and Disabling Bodies

Toggle physics on/off at runtime:

```ts
const body = useDynamicBody()

onUpdate(() => {
  if (someCondition) {
    body.disable()  // Removes from physics simulation
  } else {
    body.enable()   // Re-registers with physics
  }
})
```

## API Summary

### Composables

| Function | Returns | Purpose |
|---|---|---|
| `useStaticBody()` | `void` | Registers a static (immovable) physics body. |
| `useDynamicBody(opts?)` | `DynamicBodyHandle` | Registers a fully simulated physics body. |
| `useKinematicBody(opts?)` | `KinematicBodyHandle` | Registers a kinematic (manually driven) physics body. |
| `useBoxCollider(opts)` | `BoxColliderHandle` | Attaches a box-shaped collider. |
| `useCapsuleCollider(opts)` | `CapsuleColliderHandle` | Attaches a capsule-shaped collider. |
| `useSphereCollider(opts)` | `SphereColliderHandle` | Attaches a sphere-shaped collider. |
| `useShape(opts)` | `void` | Sets shared shape dimensions for the actor. |
| `defineLayers(def)` | `Record<string, number>` | Declares named collision layers with bitmask values. |

### Event Handlers

| Function | Callback Signature | Purpose |
|---|---|---|
| `onContact(callback)` | `(contact: ContactEvent) => void` | Fires when this entity collides with another. |
| `onSensorEnter(sensorId, callback)` | `(entityId: bigint) => void` | Fires when an entity enters a sensor collider. |
| `onSensorExit(sensorId, callback)` | `(entityId: bigint) => void` | Fires when an entity leaves a sensor collider. |

### Body Handle Methods

**DynamicBodyHandle:**
- `get velocity(): { x: number, y: number }` — Current linear velocity.
- `setVelocity(vx: number, vy: number): void` — Set velocity directly.
- `applyImpulse(ix: number, iy: number): void` — Apply instantaneous impulse.
- `applyForce(fx: number, fy: number): void` — No-op in Rapier2D; use impulse.
- `enable(): void` — Re-enable the body if disabled.
- `disable(): void` — Remove the body from simulation.
- `get active(): boolean` — Whether the body is currently in the simulation.
- `get bodyId(): number` — Unique body identifier.

**KinematicBodyHandle:** Similar to `DynamicBodyHandle`, but without impulse/force methods.

### Types

- `ContactEvent` — `{ other: bigint, relativeVelocity: number, normal: { x: number, y: number } }`
- `BoxColliderHandle` — `{ colliderId: number, isSensor: boolean }`
- `CapsuleColliderHandle` — `{ colliderId: number, isSensor: boolean }`
- `SphereColliderHandle` — `{ colliderId: number, isSensor: boolean }`

## Physics Helpers

Tree-shakable helper functions for common physics operations. Import only what you need.

> All helpers require a `physics: Physics2DAPI` instance as their first argument. Obtain it via `api.services.get('physics')` inside a system, or `usePhysics2D()` inside a composable.

### Movement

```typescript
import { moveKinematicByVelocity, applyDirectionalImpulse } from '@gwenjs/physics2d/helpers/movement'

// Move a kinematic body by velocity vector scaled by dt
moveKinematicByVelocity(physics, entityId, { x: vx, y: vy }, dt)

// Apply an impulse in a direction (for projectiles, explosions)
applyDirectionalImpulse(physics, entityId, { x: 0, y: 1 }, force)
```

### Queries

```typescript
import { getBodySnapshot, getSpeed, isSensorActive } from '@gwenjs/physics2d/helpers/queries'

// Get a snapshot of a body's physical state
const snap = getBodySnapshot(physics, entityId)
// snap: PhysicsEntitySnapshot { entityId, position, velocity }

// Get scalar speed (magnitude of velocity)
const speed = getSpeed(physics, entityId)  // number

// Check if a sensor is currently active for an entity
const active = isSensorActive(physics, entityId, sensorId)  // boolean
```

### Tilemap Chunk Orchestration

```typescript
import { createTilemapChunkOrchestrator } from '@gwenjs/physics2d/helpers/orchestration'

const orchestrator = createTilemapChunkOrchestrator(physics, {
  source: tilemapInput,
})
// TilemapChunkOrchestrator — load/unload static colliders per visible chunk
// Methods: syncVisibleChunks(chunks), patchChunk(cx, cy, source), dispose()
```

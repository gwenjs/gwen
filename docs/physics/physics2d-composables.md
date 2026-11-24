---
title: Physics 2D Composables
description: Composable-first API for 2D rigid body physics in GWEN using Rapier2D.
---

# Physics 2D Composables

**Package:** `@gwenjs/physics2d`

Physics composables are composable functions called inside `defineActor()` that add rigid body dynamics and collision to actors. They work seamlessly with the scene graph—each actor gets its own physics body, and events like collisions are dispatched per-entity.

```ts check
import { defineComponent, Types } from "@gwenjs/core";
import { defineActor, definePrefab } from "@gwenjs/core/actor";
import { useCapsuleCollider, useDynamicBody } from "@gwenjs/physics2d";
import type { CapsuleColliderHandle, DynamicBodyHandle } from "@gwenjs/physics2d";

const Position = defineComponent({
  name: "DocsPhysics2dComposablePos",
  schema: { x: Types.f32, y: Types.f32 },
  defaults: { x: 0, y: 0 },
});

const CratePrefab = definePrefab([{ def: Position, defaults: { x: 0, y: 0 } }]);

export const CrateActor = defineActor(CratePrefab, () => {
  const body: DynamicBodyHandle = useDynamicBody({ mass: 1, fixedRotation: true });
  void body;
});

export const ZoneActor = defineActor(CratePrefab, () => {
  const zone: CapsuleColliderHandle = useCapsuleCollider({ radius: 0.4, height: 1.2 });
  void zone;
});
```

## Module Configuration

All options are passed as the second element of the module tuple in `gwen.config.ts`:

```typescript
// gwen.config.ts
export default defineConfig({
  modules: ['@gwenjs/physics2d'],
  physics2d: {
    gravity: { y: -9.81 },
    qualityPreset: 'medium',
  },
})
```

| Option | Type | Default | Description |
|---|---|---|---|
| `gravity` | `{ x?: number; y?: number }` | `{ x: 0, y: -9.81 }` | Gravity in m/s². A missing axis is 0 on X and -9.81 on Y |
| `maxLinearVelocity` | `number` | `400` | Linear speed cap (m/s). Also Rapier's per-substep cap. A faster dynamic body is scaled and stays enabled |
| `maxEntities` | `number` | `10_000` | Max physics entities |
| `qualityPreset` | `'low' \| 'medium' \| 'high' \| 'esport'` | `'medium'` | Physics quality preset |
| `eventMode` | `'pull' \| 'hybrid'` | `'pull'` | Collision event read mode |
| `coalesceEvents` | `boolean` | `true` | Merge duplicate collision events |
| `ccdEnabled` | `boolean` | auto | Continuous collision detection (auto-enabled at `'high'`/`'esport'`) |
| `layers` | `Record<string, number>` | `{}` | Collision layers (bit index 0–31) |
| `debug` | `boolean` | `false` | Enable debug renderer |

:::tip Layer inlining
`gwen:physics2d` registers the `gwen:layer-inline` unit on the transform pipeline. A manual Vite config needs `gwen()` in the Vite config.
:::

## Rapier 0.36

Rapier clamps linear speed after each solver substep. The default cap is 400 m/s. `maxLinearVelocity` sets GWEN's cap and that Rapier cap (`crates/gwen-core/src/physics2d/world.rs:752-753`, `crates/gwen-core/src/physics3d/world.rs:809-810`). A new world starts at 400 (`crates/gwen-core/src/physics2d/world.rs:200`, `crates/gwen-core/src/physics3d/world.rs:714`). A value that is not finite, or that is zero or negative, is refused and both caps stay.

A body falls asleep after half a second below the sleep threshold (`rapier3d-0.36.1/src/dynamics/rigid_body_components.rs:1375`, `crates/gwen-core/tests/physics3d_rapier_036.rs:333`). An island sleeps once every body in it is eligible (`crates/gwen-core/tests/physics3d_rapier_036.rs:356`).

With one CCD substep, a fast dynamic box does not pass through a thin fixed wall even when its own CCD flag is off (`crates/gwen-core/tests/physics2d_rapier_036.rs:241`). The Low preset keeps that one substep (`crates/gwen-core/src/physics_common/quality.rs:43-47`). Zero substeps turns this CCD off, and the same box passes the wall (`crates/gwen-core/src/physics2d/world.rs:1711`).

Extra solver iterations add substeps for the whole island that contains the body. In 2D, `additionalSolverIterations` is stored at 16 or below (`packages/physics2d/src/types/api.ts:71`, `crates/gwen-core/src/physics2d/world.rs:19`, `crates/gwen-core/src/physics2d/world.rs:252`). In 3D, `set_body_solver_iterations` uses the same cap of 0–16 (`crates/gwen-core/src/physics3d/world.rs:341`, `crates/gwen-core/src/physics3d/world.rs:2805-2807`). 0 adds no extra substeps. 17 and above are stored as 16. The physics3d plugin invokes `physics3d_set_body_solver_iterations` only when the mapped count is above 0 (`packages/physics3d/src/plugin/body-management.ts:277-280`).

### Collision Layers

```typescript
export default defineConfig({
  modules: ['@gwenjs/physics2d'],
  physics2d: {
    layers: {
      player:  0,
      enemy:   1,
      terrain: 2,
      sensor:  3,
    },
  },
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
import { defineActor, definePrefab } from '@gwenjs/core/actor'
import { onUpdate } from '@gwenjs/core/system'
import { onContact, useDynamicBody } from '@gwenjs/physics2d'

const PlayerPrefab = definePrefab([{ def: Position, defaults: { x: 0, y: 0 } }])

export const PlayerActor = defineActor(PlayerPrefab, () => {
  useDynamicBody({ gravityScale: 1 })

  onContact((contact) => {
    if (contact.started) {
      console.log('Hit', contact.entityB)
    }
  })

  onUpdate(() => {
    // Update player logic each frame
  })
})
```

The module automatically:
- Registers the body with the physics simulation
- Gives `useDynamicBody` a box or a ball of half-extent 0.5
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
const CrateActor = defineActor(CratePrefab, () => {
  useDynamicBody({ mass: 5, linearDamping: 0.1 })
})

// Platform that moves on command
const PlatformActor = defineActor(PlatformPrefab, () => {
  const body = useKinematicBody()
  onUpdate(({ dt }) => {
    body.setVelocity(50, 0) // Move right at constant velocity
  })
})

// Immovable ground
const GroundActor = defineActor(GroundPrefab, () => {
  useStaticBody()
})
```

## Colliders

Each collider composable registers its own fixed body. It does not attach a shape to `useDynamicBody`.

| Composable | Shape |
|---|---|
| `useBoxCollider(opts)` | Axis-aligned rectangle. Great for characters, crates, platforms. |
| `useCapsuleCollider(opts)` | Capsule (rounded rectangle). Ideal for smooth character collisions. |
| `useSphereCollider(opts)` | Circle. Perfect for balls, explosions, round obstacles. |

```ts
// Character with capsule collider
const CharacterActor = defineActor(CharacterPrefab, () => {
  useCapsuleCollider({ radius: 0.5, height: 2 })
})

// Ball with sensor (overlap-only) collider
const BallActor = defineActor(BallPrefab, () => {
  useSphereCollider({ radius: 0.25, isSensor: true })
})
```

### Collider Options

**All colliders accept:**
- `offsetX?: number` — Local X offset from actor origin (default: 0)
- `offsetY?: number` — Local Y offset from actor origin (default: 0)
- `isSensor?: boolean` — Generates overlap events with no physical response (default: false)
- `layer?` — A name, a number, or a list of either
- `mask?` — Same shapes as `layer`
- `material?: string` — Accepted by the shared type and not applied by physics2d

**Box collider:**
- `w: number` — Width in world units
- `h: number` — Height in world units

**Capsule collider:**
- `radius: number` — Radius in world units
- `height: number` — Cylinder length. The collider is a box: half-width `radius`, half-height `height / 2`

**Sphere collider:**
- `radius: number` — Radius in world units

## Events

### Contact Events

Subscribe to collision contact events with `onContact()`:

```ts
onContact((contact) => {
  if (!contact.started) return
  console.log('Entities:', contact.entityA, contact.entityB)
})
```

The `contact` object has:
- `entityA` — Entity ID of the first participant
- `entityB` — Entity ID of the second participant
- `aColliderId` — Collider id on A when present
- `bColliderId` — Collider id on B when present
- `started` — `true` when the contact started this frame

The WASM collision record is `20` bytes: four `u32` fields and a flags byte. It has no contact point, normal, or relative velocity. `started` is bit 0 of that flags byte.

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
const PlayerActor = defineActor(PlayerPrefab, () => {
  useDynamicBody({
    layer: Layers.player,
    mask: Layers.terrain, // Only collides with terrain
  })
})

// Enemy collides with terrain and projectiles (not player)
const EnemyActor = defineActor(EnemyPrefab, () => {
  useDynamicBody({
    layer: Layers.enemy,
    mask: Layers.terrain | Layers.projectile,
  })
})

// Projectile collides with everything except other projectiles
const ProjectileActor = defineActor(ProjectilePrefab, () => {
  useDynamicBody({
    shape: "ball",
    layer: Layers.projectile,
    mask: Layers.player | Layers.enemy | Layers.terrain,
  })
})
```

## In Practice

### Platformer Character

Here's a common pattern: a character that falls with gravity, collides with terrain, and can jump when touching the ground.

```ts
import { defineActor } from '@gwenjs/core/actor'
import { onUpdate } from '@gwenjs/core/system'
import { onContact, useDynamicBody } from '@gwenjs/physics2d'

export const PlayerActor = defineActor(PlayerPrefab, () => {
  const body = useDynamicBody({
    mass: 1,
    gravityScale: 3,
    linearDamping: 0.2
  })

  let grounded = false

  onContact((contact) => {
    // The contact record has no normal. Any contact counts as grounded.
    if (contact.started) grounded = true
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
- `linearDamping?: number` — Linear velocity damping (default: 0)
- `angularDamping?: number` — Angular velocity damping (default: 0)
- `fixedRotation?: boolean` — Lock rotation (default: false)
- `shape?` — `"ball"` or a box. Both use half-extent 0.5. `useDynamicBody` does not read `useShape`
- `layer?`, `mask?` — Copied onto that box or ball

**Kinematic body options:**
- `initialPosition?` — Starting position
- `initialRotation?` — Starting angle
- `fixedRotation?` — Lock rotation

**Static body options:** `shape?` (`"box"` or `"ball"`), `layer?`, `mask?`, `isSensor?`. `useStaticBody` reads `w`, `h` and `radius` from `useShape` when that component is present.

### Applying Forces

For dynamic bodies, use the handle returned by `useDynamicBody`:

```ts
const body = useDynamicBody()

// Set velocity directly (m/s)
body.setVelocity(10, 0)

// Apply a continuous force (N) — accumulates across calls, applied each frame scaled by dt
// Use for: rockets, wind, gravity overrides, any sustained push
body.applyForce(0, 500)

// Apply an instantaneous impulse (N·s) — one-shot, immediate
// Use for: jumps, explosions, knockbacks
body.applyImpulse(0, 500)
```

### Shape Component

`useShape()` stores `w`, `h`, `radius` and `depth` on the actor. `useStaticBody` reads `w`, `h` and `radius`. `useDynamicBody` does not.

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
| `useStaticBody(opts?)` | `StaticBodyHandle` | Registers a static (immovable) physics body. |
| `useDynamicBody(opts?)` | `DynamicBodyHandle` | Registers a fully simulated physics body. |
| `useKinematicBody(opts?)` | `KinematicBodyHandle` | Registers a kinematic (manually driven) physics body. |
| `useBoxCollider(opts)` | `BoxColliderHandle` | Registers a fixed body and a box. |
| `useCapsuleCollider(opts)` | `CapsuleColliderHandle` | Registers a fixed body and a box approximation. |
| `useSphereCollider(opts)` | `CircleColliderHandle` | Registers a fixed body and a circle. |
| `useShape(opts)` | `void` | Sets shared shape dimensions for the actor. |
| `defineLayers(def)` | `Record<string, number>` | Declares named collision layers with bitmask values. |

### Event Handlers

| Function | Callback Signature | Purpose |
|---|---|---|
| `onContact(callback, entityId?)` | `(contact: CollisionContact) => void` | Fires on this engine when this entity collides. Inside an actor the entity is implied. Outside an actor, pass `entityId`. Returns `() => void`. |
| `onSensorEnter(sensorId, callback)` | `(entityId: bigint) => void` | Fires when an entity enters a sensor collider. |
| `onSensorExit(sensorId, callback)` | `(entityId: bigint) => void` | Fires when an entity leaves a sensor collider. |

### Body Handle Methods

**DynamicBodyHandle:**
- `get velocity(): { x: number, y: number }` — Current linear velocity.
- `setVelocity(vx: number, vy: number): void` — Set velocity directly.
- `applyImpulse(ix: number, iy: number): void` — Apply instantaneous impulse.
- `applyForce(fx: number, fy: number): void` — Accumulate continuous force (applied as impulse each frame, scaled by dt). Use for sustained pushes.
- `enable(): void` — Re-enable the body if disabled.
- `disable(): void` — Remove the body from simulation.
- `get active(): boolean` — Whether the body is currently in the simulation.
- `get bodyId(): number` — Unique body identifier.

**KinematicBodyHandle:** Similar to `DynamicBodyHandle`, but without impulse/force methods.

### Types

- `CollisionContact` — `{ entityA: bigint, entityB: bigint, aColliderId?: number, bColliderId?: number, started: boolean }`
- `BoxColliderHandle` — `{ colliderId: number, isSensor: boolean }`
- `CapsuleColliderHandle` — `{ colliderId: number, isSensor: boolean }`
- `CircleColliderHandle` — `{ colliderId: number, isSensor: boolean }`

## Physics Helpers

Tree-shakable helper functions for common physics operations. Import only what you need.

> All helpers require a `physics: Physics2DAPI` instance as their first argument. Obtain it with `usePhysics2D()` from `@gwenjs/physics2d`. The service key is `physics2d`.

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

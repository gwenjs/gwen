---
title: "@gwenjs/physics3d"
description: "API reference for @gwenjs/physics3d."
---

# @gwenjs/physics3d

`pnpm add @gwenjs/physics3d`

3D physics engine module powered by Rapier3D. Provides rigid body dynamics, collision detection, sensor events, layer-based filtering, and BVH-accelerated mesh colliders.

## Module Configuration

Register the module in `gwen.config.ts`:

```ts
// gwen.config.ts
export default defineConfig({
  modules: [
    ['@gwenjs/physics3d', {
      gravity: { x: 0, y: -9.81, z: 0 },
      maxEntities: 10_000,
      qualityPreset: 'medium',
      debug: false,
      coalesceEvents: true,
      layers: ['default', 'player', 'enemy'],
      vite: {
        bvhPrebake: false,
        debug: false,
      },
    }],
  ],
})
```

### Physics3DConfig

| Field | Type | Default | Description |
|---|---|---|---|
| `gravity` | `Partial<Physics3DVec3>` | `{ x: 0, y: -9.81, z: 0 }` | World gravity vector |
| `maxEntities` | `number` | `10_000` | Maximum number of physics entities |
| `qualityPreset` | `Physics3DQualityPreset` | `'medium'` | Solver quality: `'low'`, `'medium'`, `'high'`, or `'esport'` |
| `debug` | `boolean` | `false` | Enable runtime physics debug logs |
| `coalesceEvents` | `boolean` | `true` | Merge duplicate contact events within a frame |
| `layers` | `string[]` | `['default']` | Named collision layer list (max 32) |
| `vite` | `object` | — | Build-time Vite plugin options (see below) |
| `vite.bvhPrebake` | `boolean` | `false` | Pre-bake BVH for `useMeshCollider('./x.glb')` at build time |
| `vite.debug` | `boolean` | `false` | Enable Vite plugin logging |

## Composables

All composables are imported from `@gwenjs/physics3d` and must be called inside `defineActor`.

### Bodies

#### useDynamicBody(options?)

```ts
function useDynamicBody(options?: Physics3DBodyOptions): DynamicBodyHandle
```

Adds a dynamic rigid body affected by gravity and forces.

**Returns:** `DynamicBodyHandle`

```ts
import { useDynamicBody, useSphereCollider } from '@gwenjs/physics3d'

export const BallActor = defineActor(BallPrefab, () => {
  const body = useDynamicBody({ mass: 5, restitution: 0.6 })
  useSphereCollider({ radius: 1 })
})
```

#### useStaticBody(options?)

```ts
function useStaticBody(options?: Physics3DBodyOptions): void
```

Adds a static body (immobile). Use for terrain and fixed obstacles. Returns `void`.

```ts
import { useStaticBody, useMeshCollider } from '@gwenjs/physics3d'

export const TerrainActor = defineActor(TerrainPrefab, () => {
  useStaticBody()
  useMeshCollider('./terrain.glb')
})
```

#### useKinematicBody(options?)

```ts
function useKinematicBody(options?: Physics3DBodyOptions): KinematicBodyHandle
```

Adds a kinematic body controlled by velocity, not affected by gravity.

**Returns:** `KinematicBodyHandle`

```ts
import { useKinematicBody, useCapsuleCollider } from '@gwenjs/physics3d'

export const PlayerActor = defineActor(PlayerPrefab, () => {
  const body = useKinematicBody()
  useCapsuleCollider({ radius: 0.4, halfHeight: 0.9 })
})
```

### Colliders

#### useBoxCollider(options)

```ts
function useBoxCollider(options: {
  extents: Physics3DVec3
  sensor?: boolean
  density?: number
}): void
```

Adds a box collider with the given half-extents.

| Param | Type | Description |
|---|---|---|
| `options.extents` | `Physics3DVec3` | Half-size along each axis |
| `options.sensor` | `boolean` | Trigger-only (no physical response) |
| `options.density` | `number` | Collider density |

```ts
useBoxCollider({ extents: { x: 1, y: 2, z: 1 } })
```

#### useSphereCollider(options)

```ts
function useSphereCollider(options: {
  radius: number
  sensor?: boolean
  density?: number
}): void
```

Adds a sphere collider.

```ts
useSphereCollider({ radius: 0.5 })
```

#### useCapsuleCollider(options)

```ts
function useCapsuleCollider(options: {
  radius: number
  halfHeight: number
  sensor?: boolean
  density?: number
}): void
```

Adds a capsule collider (cylinder capped with hemispheres). Commonly used for character bodies.

```ts
useCapsuleCollider({ radius: 0.4, halfHeight: 0.9 })
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

#### useConvexCollider(path | options)

```ts
function useConvexCollider(source: string | {
  vertices: Float32Array
  sensor?: boolean
  density?: number
}): void
```

Adds a convex hull collider. Faster than trimesh; suitable for dynamic bodies.

```ts
useConvexCollider('./rock.glb')
```

### Events

All event composables are auto-cleaned up when the actor is destroyed.

#### onContact(handler)

```ts
function onContact(handler: (event: ContactEvent3D) => void): void
```

Registers a handler called when this actor's collider makes or breaks contact with another.

```ts
import { onContact } from '@gwenjs/physics3d'

export const EnemyActor = defineActor(EnemyPrefab, () => {
  onContact((event) => {
    if (event.started) {
      console.log('Hit by entity', event.otherId)
    }
  })
})
```

#### onSensorEnter(handler)

```ts
function onSensorEnter(handler: (otherId: number) => void): void
```

Called when another collider enters this actor's sensor collider.

```ts
import { useBoxCollider, onSensorEnter } from '@gwenjs/physics3d'

export const TriggerZone = defineActor(TriggerPrefab, () => {
  useBoxCollider({ extents: { x: 3, y: 1, z: 3 }, sensor: true })
  onSensorEnter((otherId) => {
    console.log('Entity entered zone:', otherId)
  })
})
```

#### onSensorExit(handler)

```ts
function onSensorExit(handler: (otherId: number) => void): void
```

Called when another collider leaves this actor's sensor collider.

### Layers

#### defineLayers(layerList)

```ts
function defineLayers(layerList: string[]): Record<string, number>
```

Converts a named layer list (matching the one in `gwen.config.ts`) into a bitmask object. The Vite plugin inlines these literal values at build time.

```ts
import { defineLayers } from '@gwenjs/physics3d'

const Layers = defineLayers(['default', 'player', 'enemy'])
// Layers.default === 1, Layers.player === 2, Layers.enemy === 4

useBoxCollider({
  extents: { x: 1, y: 1, z: 1 },
  // membership and filter use bitmask values
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
| `applyImpulse` | `(entity: number, impulse: Physics3DVec3) => void` | Apply an instantaneous impulse |
| `applyForce` | `(entity: number, force: Physics3DVec3) => void` | Apply a continuous force this frame |
| `applyTorque` | `(entity: number, torque: Physics3DVec3) => void` | Apply a rotational force |
| `setVelocity` | `(entity: number, velocity: Physics3DVec3) => void` | Override linear velocity |
| `getVelocity` | `(entity: number) => Physics3DVec3` | Read current linear velocity |
| `setAngularVelocity` | `(entity: number, av: Physics3DVec3) => void` | Override angular velocity |
| `getAngularVelocity` | `(entity: number) => Physics3DVec3` | Read current angular velocity |
| `raycast` | `(from: Physics3DVec3, direction: Physics3DVec3, options?: RaycastOptions) => RaycastHit[]` | Cast a ray and return hits |
| `setGravity` | `(gravity: Physics3DVec3) => void` | Change world gravity at runtime |
| `getGravity` | `() => Physics3DVec3` | Read current world gravity |

```ts
const physics = usePhysics3D()

// Jump
physics.applyImpulse(entityId, { x: 0, y: 300, z: 0 })

// Ground check
const hits = physics.raycast(
  { x: 0, y: 1, z: 0 },
  { x: 0, y: -1, z: 0 },
  { maxDistance: 1.1 }
)
const isGrounded = hits.length > 0
```

## Vite Integration

### physics3dVitePlugin(options?)

```ts
function physics3dVitePlugin(options?: GwenPhysics3DPluginOptions): VitePlugin
```

Build-time Vite plugin. It is **auto-registered** by the `@gwenjs/physics3d` module — no manual registration is needed in most projects. Configure it via the `vite` key in the module options.

```ts
interface GwenPhysics3DPluginOptions {
  debug?: boolean      // default: false — enable Vite plugin logging
  bvhPrebake?: boolean // default: false — pre-bake BVH for mesh collider paths
}
```

The plugin performs two build-time transformations:

1. **Layer inlining** — replaces `Layers.player` with its literal bitmask value. Eliminates the runtime lookup and enables dead-code elimination.
2. **BVH pre-baking** (opt-in) — detects `useMeshCollider('./terrain.glb')` patterns, compiles the BVH at build time, and replaces the path with `{ __bvhUrl: 'bvh-<hash>.bin' }`.

:::tip Unused-layer warning
When layer inlining is active, the Vite plugin emits a build warning for any layer that is defined in the config but never referenced in source code. Use this to keep your layer list tidy.
:::

:::tip BVH pre-bake workflow
Enable `bvhPrebake: true` (via `vite.bvhPrebake` in module config) for large terrain meshes. The BVH is compiled once at build time and served as a binary asset, so raycast initialisation at runtime is nearly instant — no per-frame BVH rebuild cost.
:::

:::warning Deprecated
`createGwenPhysics3DPlugin()` is deprecated. Replace with `physics3dVitePlugin({ bvhPrebake: true })` if you need manual Vite plugin registration.
:::

## Type Definitions

### Physics3DConfig

```ts
interface Physics3DConfig {
  gravity: Partial<Physics3DVec3>
  maxEntities: number
  qualityPreset: 'low' | 'medium' | 'high' | 'esport'
  debug: boolean
  coalesceEvents: boolean
  layers: string[]
  vite: {
    bvhPrebake: boolean
    debug: boolean
  }
}
```

### Physics3DVec3

```ts
interface Physics3DVec3 {
  x: number
  y: number
  z: number
}
```

### Physics3DQuat

```ts
interface Physics3DQuat {
  x: number
  y: number
  z: number
  w: number
}
```

### Physics3DQualityPreset

```ts
type Physics3DQualityPreset = 'low' | 'medium' | 'high' | 'esport'
```

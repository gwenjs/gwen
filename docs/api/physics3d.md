---
title: "@gwenjs/physics3d"
description: "API reference for @gwenjs/physics3d."
---

# @gwenjs/physics3d

`pnpm add @gwenjs/physics3d`

3D physics engine plugin powered by Rapier3D. Provides rigid body dynamics, collision detection, and advanced 3D physics features.

## Plugin Setup

### Physics3DPlugin(options?)

**Signature:**
```ts
function Physics3DPlugin(options?: Physics3DPluginOptions): PluginDef
```

**Description.** Creates the 3D physics plugin with optional configuration.

**Returns:** `PluginDef` — physics plugin definition.

**Example:**
```ts
export default defineConfig({
  plugins: [Physics3DPlugin({ quality: 'high' })],
  wasm: 'physics3d',
  // ...
});
```

## Configuration

### normalizePhysics3DConfig(input)

**Signature:**
```ts
function normalizePhysics3DConfig(input?: Partial<Physics3DConfig>): Physics3DConfig
```

**Description.** Normalizes and validates 3D physics configuration.

**Returns:** `Physics3DConfig` — validated configuration.

### Physics3DConfig

**Signature:**
```ts
interface Physics3DConfig {
  gravity: Physics3DVec3;
  quality: Physics3DQualityPreset;
  maxBodies?: number;
  maxColliders?: number;
  numSolverIterations?: number;
}
```

### QUALITY_PRESETS

**Signature:**
```ts
const QUALITY_PRESETS: {
  low: Physics3DQualityPreset;
  medium: Physics3DQualityPreset;
  high: Physics3DQualityPreset;
}
```

**Description.** Pre-configured quality presets balancing accuracy and performance.

**Example:**
```ts
const config = {
  quality: QUALITY_PRESETS.high
};
```

## Physics Service

### usePhysics3D()

**Signature:**
```ts
function usePhysics3D(): Physics3DAPI
```

**Description.** Returns the 3D physics service for runtime queries and manipulation.

**Returns:** `Physics3DAPI` — physics runtime API.

**Example:**
```ts
const physics = usePhysics3D();
physics.applyImpulse(entity, { x: 10, y: 0, z: 0 });
```

### Physics3DAPI

**Methods:**

| Method | Signature | Description |
|---|---|---|
| `applyImpulse` | `(entity: Entity, impulse: Physics3DVec3) => void` | Apply instantaneous force |
| `applyForce` | `(entity: Entity, force: Physics3DVec3) => void` | Apply continuous force |
| `applyTorque` | `(entity: Entity, torque: Physics3DVec3) => void` | Apply rotational force |
| `setVelocity` | `(entity: Entity, velocity: Physics3DVec3) => void` | Set body velocity |
| `getVelocity` | `(entity: Entity) => Physics3DVec3` | Get body velocity |
| `setAngularVelocity` | `(entity: Entity, av: Physics3DVec3) => void` | Set angular velocity |
| `getAngularVelocity` | `(entity: Entity) => Physics3DVec3` | Get angular velocity |
| `raycast` | `(from: Physics3DVec3, direction: Physics3DVec3, options?: RaycastOptions) => RaycastHit[]` | Cast a ray |
| `setGravity` | `(gravity: Physics3DVec3) => void` | Set world gravity |
| `getGravity` | `() => Physics3DVec3` | Get world gravity |
| `shapeCast` | `(shape: string, from: Physics3DVec3, direction: Physics3DVec3) => ShapeCastHit[]` | Cast a shape (sweep) |

**Example:**
```ts
const physics = usePhysics3D();
const hits = physics.raycast(
  { x: 0, y: 0, z: 0 },
  { x: 0, y: -1, z: 0 }
);
```

## Composables

Use these inside `defineActor` to add 3D physics components.

### useDynamicBody3D(options?)

**Signature:**
```ts
function useDynamicBody3D(options?: Physics3DBodyOptions): void
```

**Description.** Adds a dynamic rigid body affected by gravity and forces.

**Parameters:**
| Param | Type | Description |
|---|---|---|
| options | `Physics3DBodyOptions` | Body configuration |

**Returns:** `void`

**Example:**
```ts
defineActor('Sphere', (setup) => {
  useDynamicBody3D({ mass: 5, restitution: 0.6 });
  useSphereCollider3D({ radius: 1 });
});
```

### useStaticBody3D()

**Signature:**
```ts
function useStaticBody3D(): void
```

**Description.** Adds a static body (immobile). Use for terrain and static obstacles.

**Returns:** `void`

### useKinematicBody3D(options?)

**Signature:**
```ts
function useKinematicBody3D(options?: Physics3DBodyOptions): void
```

**Description.** Adds a kinematic body (controlled by velocity, not affected by gravity).

**Returns:** `void`

## Colliders

### useBoxCollider3D(options)

**Signature:**
```ts
function useBoxCollider3D(options: {
  extents: Physics3DVec3;
  sensor?: boolean;
  density?: number;
}): void
```

**Description.** Adds a 3D box collider.

**Parameters:**
| Param | Type | Description |
|---|---|---|
| options.extents | `Physics3DVec3` | Half-size in x, y, z |
| options.sensor | `boolean` | Trigger-only collider |
| options.density | `number` | Collision density |

**Returns:** `void`

**Example:**
```ts
useBoxCollider3D({
  extents: { x: 1, y: 2, z: 1 },
  sensor: false
});
```

### useSphereCollider3D(options)

**Signature:**
```ts
function useSphereCollider3D(options: {
  radius: number;
  sensor?: boolean;
  density?: number;
}): void
```

**Description.** Adds a 3D sphere collider.

**Returns:** `void`

### useCapsuleCollider3D(options)

**Signature:**
```ts
function useCapsuleCollider3D(options: {
  radius: number;
  halfHeight: number;
  sensor?: boolean;
  density?: number;
}): void
```

**Description.** Adds a 3D capsule collider.

**Returns:** `void`

### useConvexCollider3D(options)

**Signature:**
```ts
function useConvexCollider3D(options: {
  vertices: Physics3DVec3[];
  sensor?: boolean;
  density?: number;
}): void
```

**Description.** Adds a convex mesh collider.

**Parameters:**
| Param | Type | Description |
|---|---|---|
| options.vertices | `Physics3DVec3[]` | Convex hull vertices |
| options.sensor | `boolean` | Trigger-only |
| options.density | `number` | Collision density |

**Returns:** `void`

### useMeshCollider3D(options)

**Signature:**
```ts
function useMeshCollider3D(options: {
  vertices: Physics3DVec3[];
  indices?: number[];
  sensor?: boolean;
}): void
```

**Description.** Adds a trimesh (arbitrary mesh) collider. For static geometry only.

**Parameters:**
| Param | Type | Description |
|---|---|---|
| options.vertices | `Physics3DVec3[]` | Mesh vertices |
| options.indices | `number[]` | Triangle indices (optional) |
| options.sensor | `boolean` | Trigger-only |

**Returns:** `void`

### useCompoundCollider3D(options)

**Signature:**
```ts
function useCompoundCollider3D(options: {
  shapes: ColliderShape3D[];
  sensor?: boolean;
}): void
```

**Description.** Adds a compound collider (multiple shapes in one).

**Parameters:**
| Param | Type | Description |
|---|---|---|
| options.shapes | `ColliderShape3D[]` | Array of collider definitions |
| options.sensor | `boolean` | Trigger-only |

**Returns:** `void`

## Collider Events

### onContact3D(handler)

**Signature:**
```ts
function onContact3D(handler: (event: ContactEvent3D) => void): void
```

**Description.** Registers handler for 3D collision events.

**Example:**
```ts
defineActor('Player', (setup) => {
  onContact3D((event) => {
    console.log('Collided with:', event.other.name);
  });
});
```

### onSensor3DEnter(handler)

**Signature:**
```ts
function onSensor3DEnter(handler: (other: Entity) => void): void
```

**Description.** Called when another collider enters a sensor trigger.

### onSensor3DExit(handler)

**Signature:**
```ts
function onSensor3DExit(handler: (other: Entity) => void): void
```

**Description.** Called when another collider exits a sensor trigger.

## Mesh Collider Optimization

### preloadMeshCollider(handle)

**Signature:**
```ts
function preloadMeshCollider(handle: MeshHandle): Promise<void>
```

**Description.** Pre-computes Bounding Volume Hierarchy (BVH) for a mesh collider, improving raycast and collision detection performance. Call before adding the collider to physics.

**Parameters:**
| Param | Type | Description |
|---|---|---|
| handle | `MeshHandle` | Mesh resource handle |

**Returns:** `Promise<void>`

**Example:**
```ts
const mesh = loadMesh('terrain.gltf');
await preloadMeshCollider(mesh);
useMeshCollider3D({ vertices: mesh.vertices });
```

## Constants

| Constant | Value | Description |
|---|---|---|
| `EVENT_STRIDE_3D` | - | Event data stride for 3D physics |
| `MAX_EVENTS_3D` | - | Maximum events per frame |
| `COLLIDER_ID_ABSENT` | - | Sentinel value for absent collider ID |
| `RING_CAPACITY_3D` | - | Ring buffer capacity |

## Vite Integration

### physics3dVitePlugin()

**Signature:**
```ts
function physics3dVitePlugin(): VitePlugin
```

**Description.** Vite plugin for bundling Rapier3D WASM. Auto-registered when physics3d plugin is used.

**Returns:** `VitePlugin`

### createGwenPhysics3DPlugin()

**Signature:**
```ts
function createGwenPhysics3DPlugin(options?: Physics3DPluginOptions): PluginDef
```

**Description.** Factory function for creating a 3D physics plugin with custom options.

**Returns:** `PluginDef`

## Type Definitions

### Physics3DAPI

**Signature:**
```ts
interface Physics3DAPI {
  applyImpulse(entity: Entity, impulse: Physics3DVec3): void;
  applyForce(entity: Entity, force: Physics3DVec3): void;
  applyTorque(entity: Entity, torque: Physics3DVec3): void;
  setVelocity(entity: Entity, velocity: Physics3DVec3): void;
  getVelocity(entity: Entity): Physics3DVec3;
  setAngularVelocity(entity: Entity, av: Physics3DVec3): void;
  getAngularVelocity(entity: Entity): Physics3DVec3;
  raycast(from: Physics3DVec3, direction: Physics3DVec3, options?: RaycastOptions): RaycastHit[];
  shapeCast(shape: string, from: Physics3DVec3, direction: Physics3DVec3): ShapeCastHit[];
  setGravity(gravity: Physics3DVec3): void;
  getGravity(): Physics3DVec3;
}
```

### Physics3DBodyOptions

```ts
interface Physics3DBodyOptions {
  mass?: number;
  linearDamping?: number;
  angularDamping?: number;
  gravityScale?: number;
  restitution?: number;
  friction?: number;
  ccdEnabled?: boolean;
  dominance?: number;
}
```

### Physics3DVec3

```ts
interface Physics3DVec3 {
  x: number;
  y: number;
  z: number;
}
```

### Physics3DQuat

```ts
interface Physics3DQuat {
  x: number;
  y: number;
  z: number;
  w: number;
}
```

### Physics3DQualityPreset

```ts
type Physics3DQualityPreset = {
  numSolverIterations: number;
  numAdditionalFrictionIterations: number;
  numInternalPgsIterations: number;
  maxCcdSubsteps: number;
}
```

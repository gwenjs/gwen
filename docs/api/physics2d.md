---
title: "@gwenjs/physics2d"
description: "API reference for @gwenjs/physics2d."
---

# @gwenjs/physics2d

`pnpm add @gwenjs/physics2d`

2D physics engine plugin powered by Rapier2D. Provides rigid body dynamics, colliders, and sensors for 2D games.

## Plugin Setup

### Physics2DPlugin()

**Signature:**
```ts
function Physics2DPlugin(options?: Physics2DPluginOptions): PluginDef
```

**Description.** Creates the 2D physics plugin. Register in your app config to enable physics simulation.

**Returns:** `PluginDef` — physics plugin definition.

**Example:**
```ts
export default defineConfig({
  plugins: [Physics2DPlugin()],
  // ...
});
```

## Composables

Use these inside `defineActor` to add physics components to entities.

### useShape(options)

**Signature:**
```ts
function useShape(options: ShapeOptions): void
```

**Description.** Adds a shape (collider) to the current entity.

**Parameters:**
| Param | Type | Description |
|---|---|---|
| options | `ShapeOptions` | Shape configuration |

**Returns:** `void`

### useDynamicBody(options?)

**Signature:**
```ts
function useDynamicBody(options?: DynamicBodyOptions): void
```

**Description.** Adds a dynamic rigid body (affected by gravity and forces). Use for moving game objects.

**Parameters:**
| Param | Type | Description |
|---|---|---|
| options | `DynamicBodyOptions` | Body configuration (optional) |

**Returns:** `void`

**Example:**
```ts
const BallPrefab = definePrefab([{ def: Position, defaults: { x: 0, y: 0 } }])

export const BallActor = defineActor(BallPrefab, () => {
  useDynamicBody({ mass: 2, restitution: 0.8 })
  useBoxCollider({ w: 1, h: 1 })
})
```

### useKinematicBody(options?)

**Signature:**
```ts
function useKinematicBody(options?: KinematicBodyOptions): void
```

**Description.** Adds a kinematic body (not affected by gravity, controlled by velocity). Use for platforms, moving hazards.

**Returns:** `void`

### useStaticBody()

**Signature:**
```ts
function useStaticBody(): void
```

**Description.** Adds a static body (immobile). Use for terrain, walls, ground.

**Returns:** `void`

**Example:**
```ts
const GroundPrefab = definePrefab([{ def: Position, defaults: { x: 0, y: 0 } }])

export const GroundActor = defineActor(GroundPrefab, () => {
  useStaticBody()
  useBoxCollider({ w: 100, h: 1 })
})
```

## Colliders

### useBoxCollider(options)

**Signature:**
```ts
function useBoxCollider(options: BoxColliderOptions): void
```

**Description.** Adds a box/rectangle collider to the current entity.

**Parameters:**
| Param | Type | Description |
|---|---|---|
| options.w | `number` | Box width in world units |
| options.h | `number` | Box height in world units |
| options.isSensor | `boolean` | If true, generates overlap events with no physical response |
| options.layer | `number` | Collision membership layer bitmask |
| options.mask | `number` | Collision filter mask bitmask |
| options.offsetX | `number` | Local X offset from actor origin |
| options.offsetY | `number` | Local Y offset from actor origin |

**Returns:** `BoxColliderHandle`

**Example:**
```ts
useBoxCollider({ w: 2, h: 2, isSensor: false });
```

### useSphereCollider(options)

**Signature:**
```ts
function useSphereCollider(options: SphereColliderOptions): void
```

**Description.** Adds a circle collider to the current entity.

**Parameters:**
| Param | Type | Description |
|---|---|---|
| options.radius | `number` | Circle radius in world units |
| options.isSensor | `boolean` | If true, generates overlap events with no physical response |
| options.layer | `number` | Collision membership layer bitmask |
| options.mask | `number` | Collision filter mask bitmask |

**Returns:** `void`

### useCapsuleCollider(options)

**Signature:**
```ts
function useCapsuleCollider(options: CapsuleColliderOptions): void
```

**Description.** Adds a capsule (rounded rectangle) collider.

**Parameters:**
| Param | Type | Description |
|---|---|---|
| options.radius | `number` | Capsule radius in world units |
| options.height | `number` | Total capsule height in world units |
| options.isSensor | `boolean` | If true, generates overlap events with no physical response |
| options.layer | `number` | Collision membership layer bitmask |
| options.mask | `number` | Collision filter mask bitmask |

**Returns:** `void`

## Events

### onContact(handler)

**Signature:**
```ts
function onContact(handler: (event: ContactEvent) => void): void
```

**Description.** Registers a handler for collision events (when two colliders collide).

**Parameters:**
| Param | Type | Description |
|---|---|---|
| handler | `function` | Called with collision info |

**Returns:** `void`

**Example:**
```ts
const PlayerPrefab = definePrefab([{ def: Position, defaults: { x: 0, y: 0 } }])

export const PlayerActor = defineActor(PlayerPrefab, () => {
  onContact((event) => {
    if (event.relativeVelocity > 10) {
      // Hard impact — take damage
    }
  })
})
```

### ContactEvent

**Signature:**
```ts
interface ContactEvent {
  entityA: bigint;
  entityB: bigint;
  contactX: number;
  contactY: number;
  normalX: number;
  normalY: number;
  relativeVelocity: number;
}
```

### onSensorEnter(sensorId, callback)

**Signature:**
```ts
function onSensorEnter(sensorId: number, callback: (entityId: bigint) => void): void
```

**Description.** Called when another entity enters a sensor collider. Use the `colliderId` from the collider handle as `sensorId`.

**Example:**
```ts
export const CoinActor = defineActor(CoinPrefab, () => {
  const zone = useSphereCollider({ radius: 0.5, isSensor: true })
  onSensorEnter(zone.colliderId, (entityId) => {
    // Entity entered the coin zone
    console.log('Collected by entity:', entityId)
  })
})
```

### onSensorExit(sensorId, callback)

**Signature:**
```ts
function onSensorExit(sensorId: number, callback: (entityId: bigint) => void): void
```

**Description.** Called when another entity leaves a sensor collider.

## Layers

### defineLayers(names)

**Signature:**
```ts
function defineLayers<T extends Record<string, number>>(definition: T): Record<string, number>
```

**Description.** Declares named collision layers with their bitmask values. The Vite plugin inlines layer values at build time and warns if layers share bits.

**Parameters:**
| Param | Type | Description |
|---|---|---|
| definition | `Record<string, number>` | Object mapping layer names to bitmask values |

**Returns:** `Record<string, number>` — same object, typed with layer names as keys.

**Example:**
```ts
const Layers = defineLayers({
  player: 1 << 0,
  enemy:  1 << 1,
  wall:   1 << 2,
})
// Use Layers.player, Layers.enemy, Layers.wall
```

## Physics Service

### usePhysics2D()

**Signature:**
```ts
function usePhysics2D(): Physics2DAPI
```

**Description.** Returns the physics service for querying and manipulating bodies.

**Returns:** `Physics2DAPI` — physics runtime API.

**Example:**
```ts
const physics = usePhysics2D();
physics.applyImpulse(entityId, 10, 0);
```

### Physics2DAPI

**Methods:**

| Method | Signature | Description |
|---|---|---|
| `applyImpulse` | `(entityId: EntityId, x: number, y: number) => void` | Apply an instantaneous linear impulse |
| `setLinearVelocity` | `(entityId: EntityId, vx: number, vy: number) => void` | Override linear velocity (m/s) |
| `getLinearVelocity` | `(entityId: EntityId) => { x: number; y: number } \| null` | Read current linear velocity |
| `getPosition` | `(entityId: EntityId) => { x: number; y: number; rotation: number } \| null` | Read body position and angle |
| `getCollisionEventsBatch` | `(opts?) => CollisionEventsBatch` | Pull all collision events for this frame |
| `getCollisionContacts` | `(opts?) => ReadonlyArray<ResolvedCollisionContact>` | Read active contact pairs |
| `getSensorState` | `(entityId: EntityId, sensorId: number) => SensorState` | Read sensor overlap state |

:::tip
Most body manipulation (forces, velocities, impulses) is done through the handle returned by `useDynamicBody()` — not through `usePhysics2D()` directly. The service API is primarily used for collision event polling and spatial queries.
:::

**Example:**
```ts
const physics = usePhysics2D();

// Apply impulse directly via service API
physics.applyImpulse(entityId, 0, 500)

// Poll collision events each frame
onUpdate(() => {
  const batch = physics.getCollisionEventsBatch()
  // process batch...
})
```

## Systems

### createPhysicsKinematicSyncSystem(opts)

**Signature:**
```ts
function createPhysicsKinematicSyncSystem(opts?: {
  syncPosition?: boolean;
  syncRotation?: boolean;
}): SystemDef
```

**Description.** Creates a system that synchronizes kinematic body positions/rotations based on Transform components.

**Returns:** `SystemDef`

**Example:**
```ts
const scene = defineScene({
  systems: [
    createPhysicsKinematicSyncSystem({ syncPosition: true, syncRotation: true })
  ]
});
```

### createPlatformerGroundedSystem(opts)

**Signature:**
```ts
function createPlatformerGroundedSystem(opts?: {
  groundLayer?: LayerMask;
  raycastDistance?: number;
}): SystemDef
```

**Description.** Creates a system that tracks which entities are grounded (standing on solid ground). Useful for platformers.

**Returns:** `SystemDef`

**Example:**
```ts
export const MyScene = defineScene({
  name: 'game',
  systems: [
    createPlatformerGroundedSystem({ raycastDistance: 0.1 }),
  ],
})
```

## Tilemap Support

### buildTilemapPhysicsChunks(opts)

**Signature:**
```ts
function buildTilemapPhysicsChunks(opts: {
  tilemap: TilemapData;
  tileSize: number;
  solidTiles: number[];
  chunkSize?: number;
}): void
```

**Description.** Builds physics colliders for a tilemap using chunking for performance.

**Parameters:**
| Param | Type | Description |
|---|---|---|
| opts.tilemap | `TilemapData` | Tilemap data |
| opts.tileSize | `number` | Tile size in units |
| opts.solidTiles | `number[]` | Tile IDs that are solid |
| opts.chunkSize | `number` | Chunk grid size (optional) |

**Returns:** `void`

### patchTilemapPhysicsChunk(opts)

**Signature:**
```ts
function patchTilemapPhysicsChunk(opts: {
  tilemap: TilemapData;
  chunkX: number;
  chunkY: number;
}): void
```

**Description.** Rebuilds physics for a single tilemap chunk (for dynamic tilemap edits).

**Parameters:**
| Param | Type | Description |
|---|---|---|
| opts.chunkX | `number` | Chunk grid X |
| opts.chunkY | `number` | Chunk grid Y |

**Returns:** `void`

## Vite Integration

### physics2dVitePlugin(options?)

**Signature:**
```ts
function physics2dVitePlugin(options?: Physics2DVitePluginOptions): VitePlugin
// interface Physics2DVitePluginOptions { debug?: boolean }
```

**Description.** Vite plugin for bundling Rapier2D WASM. Auto-registered when physics2d plugin is used. Emits a build-time warning when a layer is defined with `defineLayers()` but never referenced in the same file — helps catch dead layer definitions early.

**Parameters:**
| Param | Type | Description |
|---|---|---|
| options | `Physics2DVitePluginOptions` | Optional build-time plugin options |
| options.debug | `boolean` | Enable debug logs for layer inlining (default: false) |

**Returns:** `VitePlugin`

> **Note:** When using the module config, pass Vite plugin options via the `vite` sub-key:
> ```ts
> modules: [['@gwenjs/physics2d', {
>   gravity: -9.81,
>   vite: { debug: true }  // Vite plugin options (build-time only)
> }]]
> ```

## Type Definitions

### BoxColliderOptions

```ts
interface BoxColliderOptions {
  width: number;
  height: number;
  sensor?: boolean;
  density?: number;
}
```

### SphereColliderOptions

```ts
interface SphereColliderOptions {
  radius: number;
  sensor?: boolean;
  density?: number;
}
```

### CapsuleColliderOptions

```ts
interface CapsuleColliderOptions {
  halfHeight: number;
  radius: number;
  sensor?: boolean;
  density?: number;
}
```

### DynamicBodyOptions

```ts
interface DynamicBodyOptions {
  mass?: number;
  linearDamping?: number;
  angularDamping?: number;
  gravityScale?: number;
  restitution?: number;
  friction?: number;
  ccdEnabled?: boolean;
}
```

### KinematicBodyOptions

```ts
interface KinematicBodyOptions {
  friction?: number;
  restitution?: number;
}
```

### StaticBodyOptions

```ts
interface StaticBodyOptions {
  friction?: number;
}
```

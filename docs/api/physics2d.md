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
  useBoxCollider({ width: 1, height: 1 })
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
  useBoxCollider({ width: 100, height: 1 })
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
| options.width | `number` | Box width |
| options.height | `number` | Box height |
| options.sensor | `boolean` | Is sensor (trigger-only) |

**Returns:** `void`

**Example:**
```ts
useBoxCollider({ width: 2, height: 2, sensor: false });
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
| options.radius | `number` | Circle radius |
| options.sensor | `boolean` | Is sensor (trigger-only) |

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
| options.halfHeight | `number` | Half height of capsule |
| options.radius | `number` | End radius |
| options.sensor | `boolean` | Is sensor (trigger-only) |

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
export const PlayerActor = defineActor(PlayerPrefab, () => {
  onContact((event) => {
    if (event.other.name === 'Spike') {
      // Take damage
    }
  })
})
```

### ContactEvent

**Signature:**
```ts
interface ContactEvent {
  self: Entity;
  other: Entity;
  started: boolean;
  ended: boolean;
  point: Vec2;
  normal: Vec2;
  impulse: number;
}
```

### onSensorEnter(handler)

**Signature:**
```ts
function onSensorEnter(handler: (other: Entity) => void): void
```

**Description.** Called when another collider enters a sensor trigger.

**Example:**
```ts
export const CoinActor = defineActor(CoinPrefab, () => {
  useSphereCollider({ radius: 0.5, sensor: true })
  onSensorEnter((other) => {
    if (other.name === 'Player') {
      // Collect coin
    }
  })
})
```

### onSensorExit(handler)

**Signature:**
```ts
function onSensorExit(handler: (other: Entity) => void): void
```

**Description.** Called when another collider exits a sensor trigger.

## Layers

### defineLayers(names)

**Signature:**
```ts
function defineLayers(names: string[]): LayerMask
```

**Description.** Creates layer definitions for collision filtering.

**Parameters:**
| Param | Type | Description |
|---|---|---|
| names | `string[]` | Layer name list |

**Returns:** `LayerMask` — object with layer bit flags.

**Example:**
```ts
const Layers = defineLayers(['player', 'enemy', 'wall']);
// Use Layers.player, Layers.enemy, etc.
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

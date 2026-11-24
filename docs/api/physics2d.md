---
title: "@gwenjs/physics2d"
description: "API reference for @gwenjs/physics2d."
---

# @gwenjs/physics2d

`pnpm add @gwenjs/physics2d`

2D physics engine plugin powered by Rapier2D. Provides rigid body dynamics, colliders, and sensors for 2D games.

```ts check
import { defineComponent, Types } from "@gwenjs/core";
import { defineActor, definePrefab } from "@gwenjs/core/actor";
import {
  Physics2DPlugin,
  onContact,
  useBoxCollider,
  useDynamicBody,
} from "@gwenjs/physics2d";
import type {
  BoxColliderHandle,
  BoxColliderOptions,
  DynamicBodyHandle,
  DynamicBodyOptions,
  KinematicBodyOptions,
  Physics2DConfig,
  StaticBodyOptions,
} from "@gwenjs/physics2d";

const options: Physics2DConfig = { gravity: { y: -9.81 } };
const plugin = Physics2DPlugin(options);

const Position = defineComponent({
  name: "DocsPhysics2dPos",
  schema: { x: Types.f32, y: Types.f32 },
  defaults: { x: 0, y: 0 },
});

const BallPrefab = definePrefab([{ def: Position, defaults: { x: 0, y: 0 } }]);

export const BallActor = defineActor(BallPrefab, () => {
  const bodyOptions: DynamicBodyOptions = { mass: 2, fixedRotation: true };
  const body: DynamicBodyHandle = useDynamicBody(bodyOptions);
  const pose: KinematicBodyOptions<"2d"> = {
    initialPosition: { x: 0, y: 2 },
    initialRotation: 0,
  };
  const ground: StaticBodyOptions = { shape: "box", isSensor: false };
  onContact((contact) => {
    void contact.started;
    void body;
    void pose;
    void ground;
  });
});

export const BoxActor = defineActor(BallPrefab, () => {
  const boxOptions: BoxColliderOptions<"2d"> = { w: 1, h: 1, isSensor: false };
  const box: BoxColliderHandle = useBoxCollider(boxOptions);
  void box;
});

void plugin;
```

## Plugin Setup

### Physics2DPlugin()

`Physics2DPlugin` is the value `createPhysicsPlugin` builds for `@gwenjs/physics2d` and the service key `physics2d`. Options are `Physics2DConfig`. See [Plugin](./physics-core#plugin).

`options.layers` maps each name to a bit index in `[0, 31]`, at most 32 names. A bit outside that range, or more than 32 layers, makes `engine.use(Physics2DPlugin(...))` reject `CORE:PLUGIN_OPTIONS_INVALID`. The issue path is `layers.<name>` for a bit and `layers` for the count. Calling `Physics2DPlugin(...)` does not throw for layers.

**Example:**
```ts
export default defineConfig({
  plugins: [Physics2DPlugin({ gravity: { y: -9.81 } })],
});
```

## Composables

Use these inside `defineActor` to add physics components to entities.

### useShape(options)

**Signature:**
```ts
function useShape(options: ShapeOptions): void
```

**Description.** Stores `w`, `h`, `radius` and `depth` on the entity (`ShapeOptions`). `useStaticBody` reads `w`, `h` and `radius`. `useDynamicBody` does not. It always adds a box or a ball with half-extent 0.5.

**Returns:** `void`

### useDynamicBody(options?)

**Signature:**
```ts
function useDynamicBody(options?: DynamicBodyOptions): DynamicBodyHandle
```

**Description.** Adds a dynamic rigid body. Fields: `shape?`, `layer?`, `mask?`, `mass?`, `linearDamping?`, `angularDamping?`, `fixedRotation?`, `gravityScale?`. `shape: "ball"` adds a ball. Any other shape adds a box. Both use half-extent 0.5. There is no `restitution` field.

**Returns:** `DynamicBodyHandle` (`bodyId`, `active`, `velocity`, `applyForce`, `applyImpulse`, `setVelocity`, `enable`, `disable`).

**Example:**
```ts
const BallPrefab = definePrefab([{ def: Position, defaults: { x: 0, y: 0 } }])

export const BallActor = defineActor(BallPrefab, () => {
  const body = useDynamicBody({ mass: 2, fixedRotation: true })
  void body
})
```

### useKinematicBody(options?)

**Signature:**
```ts
function useKinematicBody(options?: KinematicBodyOptions<"2d">): KinematicBodyHandle
```

**Description.** Adds a kinematic body. Fields: `initialPosition?`, `initialRotation?`, `fixedRotation?`. Gravity does not move it. Drive it with `setVelocity` or `moveTo`.

**Returns:** `KinematicBodyHandle`

### useStaticBody(options?)

**Signature:**
```ts
function useStaticBody(options?: StaticBodyOptions): StaticBodyHandle
```

**Description.** Adds a static body. Fields: `shape?`, `layer?`, `mask?`, `isSensor?`. When a shape component is present, a ball uses its `radius` and a box uses `w / 2` and `h / 2`. Otherwise the half-extent is 0.5.

**Returns:** `StaticBodyHandle`

**Example:**
```ts
const GroundPrefab = definePrefab([{ def: Position, defaults: { x: 0, y: 0 } }])

export const GroundActor = defineActor(GroundPrefab, () => {
  useShape({ w: 100, h: 1 })
  useStaticBody()
})
```

## Colliders

### useBoxCollider(options)

**Signature:**
```ts
function useBoxCollider(options: BoxColliderOptions<"2d">): BoxColliderHandle
```

**Description.** Registers a fixed body and a box collider on the actor entity. It does not attach a shape to `useDynamicBody`. `w` and `h` are full sizes. The collider half-extents are `w / 2` and `h / 2`. Optional fields: `offsetX`, `offsetY`, `isSensor`, `layer`, `mask`, `material`. `material` is accepted and not applied. `oneWay` is not a field of this options type.

**Returns:** `BoxColliderHandle` (`colliderId`, `isSensor`)

**Example:**
```ts
useBoxCollider({ w: 2, h: 2, isSensor: false });
```

### useSphereCollider(options)

**Signature:**
```ts
function useSphereCollider(options: SphereColliderOptions<"2d">): CircleColliderHandle
```

**Description.** Registers a fixed body and a circle collider. It does not attach a shape to `useDynamicBody`. Fields: `radius`, and the same optional `offsetX`, `offsetY`, `isSensor`, `layer`, `mask`, `material`. `material` is accepted and not applied.

**Returns:** `CircleColliderHandle` (`colliderId`, `isSensor`)

### useCapsuleCollider(options)

**Signature:**
```ts
function useCapsuleCollider(options: CapsuleColliderOptions<"2d">): CapsuleColliderHandle
```

**Description.** Registers a fixed body. The API has no capsule primitive, so this stores a box. The half-width is `radius`. The half-height is `height / 2`. Optional fields match the box filter fields. `material` is accepted and not applied.

**Returns:** `CapsuleColliderHandle` (`colliderId`, `isSensor`)

## Events

### physics2d:body-disabled

The plugin emits this hook after a step that disabled a body. The payload is `{ entity, reason }`. `reason` is `non-finite`, `out-of-bounds`, or `velocity`. The body stays registered. A query or `getPosition` still answers. A dynamic body and a body Rapier quarantines are both included (`crates/gwen-core/src/physics2d/world.rs:922`).

```ts
engine.hooks.hook("physics2d:body-disabled", ({ entity, reason }) => {
  // reason is "non-finite", "out-of-bounds", or "velocity"
  void entity;
  void reason;
});
```

`non-finite` means a dynamic translation or linear velocity is not finite, or Rapier quarantined the body, including a kinematic target that is not finite. `out-of-bounds` means a dynamic position sits outside ±1e7. `velocity` means a dynamic position after the clamp would pass ±1e7.

The default cap of 400 m/s slows a faster dynamic body. A step delta above 1 s is refused with `PHYSICS2D:INVALID_STEP_DELTA`.

### onContact(handler, entityId?)

**Signature:**
```ts
function onContact(callback: (contact: CollisionContact) => void, entityId?: EntityId): () => void
```

**Description.** Registers a handler for collision events (when two colliders collide).

**Parameters:**
| Param | Type | Description |
|---|---|---|
| callback | `(contact: CollisionContact) => void` | Called with one contact. `entityA`, `entityB`, optional `aColliderId` and `bColliderId`, and `started`. |
| entityId | `EntityId` | Optional. Limits the callback to contacts that include this entity. Inside `defineActor`, the actor entity is used when this is omitted. |

**Returns:** `() => void`

**Example:**
```ts
const PlayerPrefab = definePrefab([{ def: Position, defaults: { x: 0, y: 0 } }])

export const PlayerActor = defineActor(PlayerPrefab, () => {
  onContact((event) => {
    if (event.started) {
      // Contact began this frame
    }
  })
})
```

### CollisionContact

`CollisionContact` comes from `@gwenjs/physics-core`. Fields: `entityA`, `entityB`, optional `aColliderId` and `bColliderId`, and `started`.

### onSensorEnter(sensorId, callback)

**Signature:**
```ts
function onSensorEnter(sensorId: number, callback: (entityId: bigint) => void): () => void
```

**Description.** Called when another entity enters a sensor collider. Use the `colliderId` from the collider handle as `sensorId`. Inside an actor, the callback is removed when the actor's entity is destroyed. Outside an actor, call the returned function to remove it.

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
function onSensorExit(sensorId: number, callback: (entityId: bigint) => void): () => void
```

**Description.** Called when another entity leaves a sensor collider. Returns a function that removes the callback.

## Layers

`Physics2DPlugin({ layers })` takes bit indices. A bit outside `[0, 31]`, or more than 32 layers, makes `engine.use(Physics2DPlugin(...))` reject `CORE:PLUGIN_OPTIONS_INVALID` (paths `layers.<name>` and `layers`). The factory call itself does not throw for layers.

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
| `setLinearDamping` | `(entityId: EntityId, damping: number) => void` | Update linear damping coefficient at runtime (≥ 0) |
| `getLinearVelocity` | `(entityId: EntityId) => { x: number; y: number } \| null` | Read current linear velocity |
| `getPosition` | `(entityId: EntityId) => { x: number; y: number; rotation: number } \| null` | Read body position and angle |
| `getCollisionEventsBatch` | `(opts?) => CollisionEventsBatch` | Pull all collision events for this frame |
| `getCollisionContacts` | `(opts?) => ReadonlyArray<ResolvedCollisionContact>` | Read active contact pairs |
| `getSensorState` | `(entityId: EntityId, sensorId: number) => SensorState` | Read sensor overlap state |
| `queryRadius` | `(x, y, radius, opts?) => EntityId[]` | Return all entities whose colliders intersect a circle |
| `queryRect` | `(x, y, hw, hh, opts?) => EntityId[]` | Return all entities whose colliders intersect an AABB |
| `pointQuery` | `(x, y, opts?) => EntityId[]` | Return all entities whose colliders contain a point |

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

### Spatial queries

`queryRadius`, `queryRect`, and `pointQuery` return all entities overlapping the given shape. All three accept an optional `QueryFilterOpts` to restrict results by collision layer.

```ts
const physics = usePhysics2D();

// All enemies within 5 metres of the player
const nearby = physics.queryRadius(player.x, player.y, 5, {
  mask: ['enemy'],
})

// Everything overlapping a 4×2 trigger zone
const inZone = physics.queryRect(doorX, doorY, 2, 1, {
  mask: ['player', 'item'],
})

// What is at the cursor position?
const underCursor = physics.pointQuery(worldX, worldY)
```

### setLinearDamping

Adjust linear damping on a live dynamic body without removing and re-adding it. Useful for ice/water surface transitions.

```ts
const physics = usePhysics2D();

// Entering water — slow down gradually
physics.setLinearDamping(entityId, 4.0)

// Back on land — restore default
physics.setLinearDamping(entityId, 0.0)
```

### One-way platforms

`oneWay` is a field of `ColliderOptions`. `addBoxCollider` reads it and passes it to the box collider. `useBoxCollider` does not accept `oneWay`.

```ts
const physics = usePhysics2D()
physics.addBoxCollider(entityId, 2, 0.1, { oneWay: true })
```

## Systems

### createPhysicsKinematicSyncSystem(options)

**Signature:**
```ts
function createPhysicsKinematicSyncSystem(
  options?: PhysicsKinematicSyncSystemOptions,
): GwenPlugin
```

**Description.** Returns the plugin object from `definePlugin`. Each frame it copies the ECS position into the kinematic body. `positionComponent` is required at runtime. Without it the call throws `Physics2DErrorCodes.POSITION_COMPONENT_REQUIRED`. The parameter is typed optional. `pixelsPerMeter` defaults to 50.

`Physics2DPlugin` must be installed first. Otherwise `engine.use` rejects `CORE:PLUGIN_DEPENDENCY_MISSING`.

**Returns:** `GwenPlugin`

**Example:**
```ts
await engine.use(Physics2DPlugin({ gravity: { x: 0, y: 0 } }))
await engine.use(createPhysicsKinematicSyncSystem({ pixelsPerMeter: 50, positionComponent: Position }))
```

### createPlatformerGroundedSystem(opts)

**Signature:**
```ts
function createPlatformerGroundedSystem(
  options: PlatformerGroundedSystemOptions & { physics: Physics2DAPI },
): { isGrounded(entityId: EntityId): boolean; getSensorState(entityId: EntityId): SensorState }
```

**Description.** Not a system definition. It reads the foot sensor through `physics.getSensorState`. `sensorId` defaults to `SENSOR_ID_FOOT`. There is no `groundLayer` and no `raycastDistance`.

**Returns:** `{ isGrounded, getSensorState }`

**Example:**
```ts
const physics = usePhysics2D()
const grounded = createPlatformerGroundedSystem({ physics })
```

## Tilemap Support

### buildTilemapPhysicsChunks(opts)

**Signature:**
```ts
function buildTilemapPhysicsChunks(
  input: BuildTilemapPhysicsChunksInput,
): TilemapPhysicsChunkMap
```

**Description.** Bakes a tile grid into physics chunks. Fields: `tiles`, `mapWidthTiles`, `mapHeightTiles`, optional `chunkSizeTiles`, `tileSizePx`, and `isSolidTile`. It does not take `tilemap`, `tileSize`, or `solidTiles`.

**Returns:** `TilemapPhysicsChunkMap`

### patchTilemapPhysicsChunk(opts)

**Signature:**
```ts
function patchTilemapPhysicsChunk(
  input: PatchTilemapPhysicsChunkInput,
): TilemapPhysicsChunkMap
```

**Description.** Rebuilds one chunk. Fields: `source` (`BuildTilemapPhysicsChunksInput`), `chunkX`, `chunkY`, and `previous` (`TilemapPhysicsChunkMap`).

**Returns:** `TilemapPhysicsChunkMap`

## Vite Integration

### physics2dVitePlugin(options?)

**Signature:**
```ts
function physics2dVitePlugin(options?: Physics2DVitePluginOptions): Plugin
// import { physics2dVitePlugin } from '@gwenjs/physics2d/module'
```

**Description.** Registers the `gwen:layer-inline` unit on `gwen:transform-pipeline`. Auto-registered when the physics2d module is used. A manual Vite config needs `gwen()` from `@gwenjs/vite` in the Vite config. `Physics2DVitePluginOptions` is empty.

**Parameters:**
| Param | Type | Description |
|---|---|---|
| options | `Physics2DVitePluginOptions` | Empty. The plugin takes no options |

**Returns:** `Plugin` (the Vite plugin type). `Physics2DVitePluginOptions` is an empty record.

> **Note:** `Physics2DConfig` has no `vite` key. The module calls `physics2dVitePlugin()` with no options.
> ```ts
> // gwen.config.ts
> export default defineConfig({
>   modules: ['@gwenjs/physics2d'],
>   physics2d: {
>     gravity: { y: -9.81 },
>     maxLinearVelocity: 400, // metres per second; also Rapier's per-substep cap
>   },
> })
> ```

## Rapier 0.36

Rapier clamps linear speed after each solver substep. The default cap is 400 m/s. `maxLinearVelocity` sets GWEN's cap and that Rapier cap (`crates/gwen-core/src/physics2d/world.rs:752-753`, `crates/gwen-core/src/physics3d/world.rs:809-810`). A new world starts at 400 (`crates/gwen-core/src/physics2d/world.rs:200`, `crates/gwen-core/src/physics3d/world.rs:714`). A value that is not finite, or that is zero or negative, is refused and both caps stay.

A body falls asleep after half a second below the sleep threshold (`rapier3d-0.36.1/src/dynamics/rigid_body_components.rs:1375`, `crates/gwen-core/tests/physics3d_rapier_036.rs:333`). An island sleeps once every body in it is eligible (`crates/gwen-core/tests/physics3d_rapier_036.rs:356`).

With one CCD substep, a fast dynamic box does not pass through a thin fixed wall even when its own CCD flag is off (`crates/gwen-core/tests/physics2d_rapier_036.rs:241`). The Low preset keeps that one substep (`crates/gwen-core/src/physics_common/quality.rs:43-47`). Zero substeps turns this CCD off, and the same box passes the wall (`crates/gwen-core/src/physics2d/world.rs:1711`).

Extra solver iterations add substeps for the whole island that contains the body. In 2D, `additionalSolverIterations` is stored at 16 or below (`packages/physics2d/src/types/api.ts:71`, `crates/gwen-core/src/physics2d/world.rs:19`, `crates/gwen-core/src/physics2d/world.rs:252`). In 3D, `set_body_solver_iterations` uses the same cap of 0–16 (`crates/gwen-core/src/physics3d/world.rs:341`, `crates/gwen-core/src/physics3d/world.rs:2805-2807`). 0 adds no extra substeps. 17 and above are stored as 16. The physics3d plugin invokes `physics3d_set_body_solver_iterations` only when the mapped count is above 0 (`packages/physics3d/src/plugin/body-management.ts:277-280`).

## Type Definitions

### BoxColliderOptions

`BoxColliderOptions<"2d">` is the shared filter (`layer?`, `mask?`, `isSensor?`, `material?`) plus `w`, `h`, `offsetX?` and `offsetY?`. There is no `width` field. `d` exists only on the 3D form.

### SphereColliderOptions

`SphereColliderOptions<"2d">` is the same filter plus `radius`, `offsetX?` and `offsetY?`.

### CapsuleColliderOptions

`CapsuleColliderOptions<"2d">` is the same filter plus `radius`, `height`, `offsetX?` and `offsetY?`.

### DynamicBodyOptions

Fields: `shape?` (`"box"` or `"ball"`), `layer?`, `mask?`, `mass?`, `linearDamping?`, `angularDamping?`, `fixedRotation?`, `gravityScale?`.

### KinematicBodyOptions<"2d">

Use `KinematicBodyOptions<"2d">`. Fields: `initialPosition?` (`Vec2`), `initialRotation?` (radians), `fixedRotation?`. The type is declared once, in `@gwenjs/physics-core`.

### StaticBodyOptions

Fields: `shape?` (`"box"` or `"ball"`), `layer?`, `mask?`, `isSensor?`.

### QueryFilterOpts

Optional layer filter accepted by `queryRadius`, `queryRect`, and `pointQuery`.

```ts
interface QueryFilterOpts {
  /** Layers the querying shape belongs to. Name, bitmask, or a list of either. */
  layer?: string | number | readonly (string | number)[];
  /** Layers the query can hit. Name, bitmask, or a list of either. */
  mask?: string | number | readonly (string | number)[];
}
```

When omitted, both fields default to `0xFFFFFFFF` (all layers).

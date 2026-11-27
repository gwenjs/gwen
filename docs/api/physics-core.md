---
title: "@gwenjs/physics-core"
description: Shared physics types, layer masks and collision-event readers for both dimensions.
---

# @gwenjs/physics-core

`pnpm add @gwenjs/physics-core`

One declaration of a collider option, a sensor callback and a layer mask. `@gwenjs/physics2d` and `@gwenjs/physics3d` adapt this package. They do not declare those shapes again.

```ts check
import { defineLayers } from '@gwenjs/physics-core'
import type { KinematicBodyOptions } from '@gwenjs/physics-core'

const masks = defineLayers({ ground: 1 << 0, player: 1 << 1 })
const player: number = masks.player

const pose: KinematicBodyOptions<'2d'> = {
  initialPosition: { x: 0, y: 2 },
  initialRotation: 0,
}
```

## Layers

`defineLayers` returns its input. Its values are masks (`1 << 0`, `1 << 1`). The values of `LayerRegistry` and `PhysicsConfigBase.layers` are bit indices. `LayerRegistry.resolve` turns a name into `1 << bit`, keeps a number, and OR-s an array. The registry accepts at most 32 layers. A bit must be an integer from 0 to 31. An unknown name is an error.

The codes passed to `onError` are `LAYER_ERROR_CODES`. They have no dimension prefix. The dimension package maps them onto its own codes.

## Events

`readCollisionEvents` fills a caller-owned pool.

Stride 16 is the 3D layout: flags `u32` at +8, collider ids `u16` at +12 and +14. An id of `0xffff` is absent.

Stride 20 is the live 2D layout: collider ids `u32` at +8 and +12, flags `u8` at +16. An id of `0xffffffff` is absent.

A count of 0 writes nothing. A count past the pool stops at the pool.

## Callbacks

`onContact`, `onSensorEnter` and `onSensorExit` use the current engine. Outside that context they throw `GwenContextError` with code `CORE:OUTSIDE_ENGINE_CONTEXT`. Each engine's list dies with that engine's `stop()`. A removal during `emit` waits until the outermost `emit` returns, and that entry stays in the list for the walk. Outside `emit` the entry drops at once. `clearEngineContacts` and `stop()` empty the lists at once, even during a walk. `ContactRegistry.removeEntity` drops every entry for that entity. `SensorRegistry.remove` drops every entry whose callback is in the list. An empty `remove` drops nothing. `onSensorEnter` and `onSensorExit` take an optional `ownerEntityId`. When it is passed, the callback runs only for that entity. When it is omitted, the callback runs for every entity. `emit` keeps registration order and skips a set owner that is not the event entity. `SensorRegistry.removeOwned(entityId, sensorId?)` drops that owner's callbacks. A `sensorId` drops only that sensor. A second call drops nothing. During `emit` the drop waits until the outermost `emit` returns.

## Module

`definePhysicsModule` builds a module from a `PhysicsModuleDefinition`. Its `setup` registers the plugin declaration with the resolved options, copies the auto-imports in the given order, and adds the Vite plugin built from those options. `defaults` and `validate` stay the objects the caller passed. An empty name is rejected with code `KIT:MODULE_INVALID`.

## Plugin

`createPhysicsPlugin` builds a plugin from a `PhysicsAdapter`. `setup` stores `api` under the service key and routes `prefab:instantiate`, `entity:destroy`, `engine:before-update` and `engine:update` to that adapter. `beginFrame`, when the adapter has one, runs on every `engine:before-update`. `step` runs only when `dt > 0`. On `engine:update` the plugin reads `eventView`. No view, or a count of 0, emits nothing. Otherwise sensor transitions run first. Inside one transition, `onSensorEnter` or `onSensorExit` runs, then the `physics:sensor:changed` hook. When the resolved contact list is empty, the plugin calls neither `physics:collision`, nor `onContact`, nor `onContacts`. Sensor transitions of that frame still run. When the list is not empty, the order continues with the `physics:collision` hook, the `onContact` callbacks, then `onContacts`. An enter fires when `isActive` flips from false to true. An exit fires when it flips from true to false. `update` and the dispatch step the stored count and set `isActive` to `count > 0`. The count never drops below 0. An id `resolveSensorId` does not accept does not change that sensor. Destroying an entity forgets that entity's sensor counts. It also drops that owner's sensor callbacks (`SensorRegistry.removeOwned`). No exit and no `physics:sensor:changed` is fired for it. A rejected `physics:collision` handler is reported on the engine error bus with code `CORE:PLUGIN_RUNTIME_ERROR` and the plugin name as source. `makeAdapter` receives that plugin's `PhysicsSensorTracker`. `set` stores `contactCount` and `isActive` as given, including `isActive: true` with `contactCount: 0` and `isActive: false` with a count above 0. `read` returns that pair. `update` steps the same count as the dispatch and emits nothing. `set` emits nothing. `teardown` clears that engine's contact and sensor callbacks, then calls `dispose`. A second `teardown` does not clear callbacks registered after the first, and does not call `dispose` again. A throw from the adapter factory is the error `engine.use` rejects with.

## Migration

Names that landed with the shared physics layer. Hook order, the empty-contact rule, and `set` / `removeOwned` stay in [Plugin](#plugin) and [Callbacks](#callbacks).

| Kind | Old | New |
| --- | --- | --- |
| export | `RigidBodyType`, `BODY_TYPE` (2D), `Physics3DBodyKind` (3D) | `BodyKind`, `BODY_KIND_CODE` (`@gwenjs/physics-core`) |
| export | `PhysicsQualityPreset`, `Physics3DQualityPreset`, `QUALITY_PRESETS` | `QualityPreset`, `QUALITY_PRESET_CODE` (`@gwenjs/physics-core`) |
| export | `Physics3DVec3`, `Physics3DQuat`, `Physics3DEntityId` | `Vec3`, `Quat` (`@gwenjs/math`), `EntityId` (`@gwenjs/schema`) |
| export | `Physics3DCollisionContact`, `Physics3DSensorState` (3D). The 2D declarations used those contact and sensor names. | `CollisionContact`, `SensorState` (`@gwenjs/physics-core`) |
| export | `ContactEvent` (2D), `ContactEvent3D` | removed. The payload is `CollisionContact` (`@gwenjs/physics-core`) |
| option | `membershipLayers` / `filterLayers` (2D collider), `layers` (3D collider, compound collider, bulk static boxes, and spatial query bitmask) | `layer` / `mask` |
| option | `materialPreset` (3D) | `material`, a string |
| option | `initialAngle` (2D kinematic) | `initialRotation` |
| option | prefab field `initialVelocity` with components vx and vy (2D) | `initialLinearVelocity` |
| option | a numeric gravity plus `gravityX` (2D) | `gravity` as a partial `Vec2` |
| option | 3D config `layers` typed as a list of strings | `layers` as `Record<string, number>`. Past 32 names, or a bit outside 0..31, the call throws `PHYSICS3D:INVALID_LAYERS` |
| option | `BoxColliderOptions.d` (2D) | removed |
| hook | `physics3d:collision`, `physics3d:sensor:changed` | `physics:collision`, `physics:sensor:changed` |
| hook | `physics3d:step`, `physics3d:collisionStart`, `physics3d:collisionEnd` (never fired) | removed |
| key | prefab extension `physics` (2D) | `physics2d` |
| signature | `addBoxCollider` / `addBallCollider` taking a body handle first (2D) | the first argument is `entityId` |
| signature | `createPhysicsKinematicSyncSystem` as a plain object | a `definePlugin` value. It needs the `physics2d` or `physics3d` service, or `engine.use` rejects `CORE:PLUGIN_DEPENDENCY_MISSING` |

### Behaviour changes

| Topic | What changed |
| --- | --- |
| 2D step | No step when `dt` is NaN, or is 0 or negative. A delta above 1 s, `Infinity` included, throws `PHYSICS2D:INVALID_STEP_DELTA`. |
| 3D force | `applyForce` stores the force and applies it once per frame as force times `dt`. |
| 3D filters | A collider `layer` and `mask` take effect. |
| 3D material | An unknown material name throws `PHYSICS3D:UNKNOWN_MATERIAL`. |
| 2D contacts | Registry callbacks receive `aColliderId` and `bColliderId`. Prefab `onCollision` runs after every `onContact`. A frame with no owned contact emits no `physics:collision`. See [Plugin](#plugin). |
| 3D order | Sensor transitions run before `physics:collision` and `onContact`. Sensor callbacks run before `physics:sensor:changed`. Sensor transitions still run on a frame with no owned contact. See [Plugin](#plugin). |
| 3D removal | Removing an `onContact` callback during dispatch keeps the current event. Sensor callbacks run in registration order. |
| 3D readback | `getCollisionContacts` is empty inside collision and sensor handlers. |
| Teardown | `teardown()` outside an engine does not throw. |
| Tracker | `PhysicsSensorTracker` and `SensorRegistry` gain `set` and `removeOwned`. See [Plugin](#plugin). |
| Vite | The Vite plugin factories are imported from the package `module` entry. |
| Speed cap | The default `maxLinearVelocity` is 400 metres per second. |

Not renamed. The generic dimension parameter did not ship. `BoxColliderOptions3D`, `DynamicBodyOptions3D`, `DynamicBodyHandle3D`, `KinematicBodyOptions3D`, `BoxColliderHandle3D`, `SphereColliderHandle3D`, `CapsuleColliderHandle3D` and `CircleColliderHandle` stay exported. No row owns that rename.
